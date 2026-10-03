<?php

namespace App\Models;

final class Teacher extends BaseModel
{
    public function create(int $userId, array $context, array $subjects): void
    {
        $this->createWithTerms($userId, [['context' => $context, 'subjects' => $subjects]]);
    }

    public function createWithTerms(int $userId, array $terms): void
    {
        if (!$terms) throw new \InvalidArgumentException('At least one teacher term is required.');
        $primary = null;
        $classNames = [];
        foreach ($terms as $term) {
            $classNames[] = $term['context']['class_name'];
            if ($primary === null && !empty($term['subjects'])) $primary = $term['subjects'][0];
        }
        $this->db->prepare(
            'INSERT INTO teachers(user_id,class_name,subject_id,subject_code,year_level) VALUES(?,?,?,?,?)'
        )->execute([
            $userId,
            implode(',', array_values(array_unique($classNames))),
            $primary['id'] ?? null,
            $primary['code'] ?? null,
            $primary['year_level'] ?? $terms[0]['context']['year_level'],
        ]);
        $teacherId = (int) $this->db->lastInsertId();
        foreach ($terms as $term) $this->storeTerm($teacherId, $term['context'], $term['subjects']);
        $this->syncLegacyFields($teacherId);
    }

    public function byUser(int $userId): ?array
    {
        return $this->one('SELECT t.* FROM teachers t WHERE t.user_id=?', [$userId]);
    }

    public function subjectsByUser(int $userId): array
    {
        return array_map([$this, 'castAssignment'], $this->all(
            'SELECT ts.id assignment_id,ts.subject_id id,ts.teacher_term_id,sub.code,sub.name,sub.year_level,sub.semester_id,'
            . 'sem.semester_number,sem.name semester_name,ay.id academic_year_id,ay.name academic_year_name,'
            . 'c.id class_id,c.name class_name '
            . 'FROM teachers t JOIN teacher_subjects ts ON ts.teacher_id=t.id '
            . 'JOIN teacher_terms tt ON tt.id=ts.teacher_term_id '
            . 'JOIN subjects sub ON sub.id=ts.subject_id AND sub.semester_id=tt.semester_id '
            . 'JOIN semesters sem ON sem.id=tt.semester_id JOIN academic_years ay ON ay.id=sem.academic_year_id '
            . 'JOIN classes c ON c.id=tt.class_id AND c.academic_year_id=ay.id '
            . 'WHERE t.user_id=? ORDER BY ay.year_level,sem.semester_number,c.name,sub.name,sub.id',
            [$userId]
        ));
    }

    public function termsByUser(int $userId): array
    {
        $rows = $this->all(
            'SELECT tt.id teacher_term_id,tt.semester_id,sem.semester_number,sem.name semester_name,'
            . 'ay.id academic_year_id,ay.year_level,ay.name academic_year_name,c.id class_id,c.name class_name,'
            . 'ts.id assignment_id,sub.id subject_id,sub.code,sub.name subject_name '
            . 'FROM teachers t JOIN teacher_terms tt ON tt.teacher_id=t.id '
            . 'JOIN semesters sem ON sem.id=tt.semester_id JOIN academic_years ay ON ay.id=sem.academic_year_id '
            . 'JOIN classes c ON c.id=tt.class_id '
            . 'LEFT JOIN teacher_subjects ts ON ts.teacher_term_id=tt.id '
            . 'LEFT JOIN subjects sub ON sub.id=ts.subject_id '
            . 'WHERE t.user_id=? ORDER BY ay.year_level,sem.semester_number,c.name,sub.name,sub.id',
            [$userId]
        );
        $terms = [];
        foreach ($rows as $row) {
            $termId = (int) $row['teacher_term_id'];
            if (!isset($terms[$termId])) {
                $terms[$termId] = [
                    'id' => $termId,
                    'semester_id' => (int) $row['semester_id'],
                    'semester_number' => (int) $row['semester_number'],
                    'semester_name' => $row['semester_name'],
                    'academic_year_id' => (int) $row['academic_year_id'],
                    'year_level' => (int) $row['year_level'],
                    'academic_year_name' => $row['academic_year_name'],
                    'class_id' => (int) $row['class_id'],
                    'class_name' => $row['class_name'],
                    'subjects' => [],
                ];
            }
            if ($row['subject_id'] !== null) {
                $terms[$termId]['subjects'][] = [
                    'assignment_id' => (int) $row['assignment_id'],
                    'id' => (int) $row['subject_id'],
                    'code' => $row['code'],
                    'name' => $row['subject_name'],
                ];
            }
        }
        return array_values($terms);
    }

    public function assignmentForTeacher(int $teacherId, int $assignmentId = 0, int $subjectId = 0): ?array
    {
        $where = $assignmentId > 0 ? 'ts.id=?' : 'ts.subject_id=?';
        $value = $assignmentId > 0 ? $assignmentId : $subjectId;
        if ($value <= 0) return null;
        $row = $this->one(
            'SELECT ts.id assignment_id,ts.teacher_term_id,ts.subject_id id,sub.code,sub.name,sub.year_level,sub.semester_id,'
            . 'sem.semester_number,sem.name semester_name,ay.id academic_year_id,ay.name academic_year_name,'
            . 'c.id class_id,c.name class_name '
            . 'FROM teacher_subjects ts JOIN teacher_terms tt ON tt.id=ts.teacher_term_id '
            . 'JOIN subjects sub ON sub.id=ts.subject_id AND sub.semester_id=tt.semester_id '
            . 'JOIN semesters sem ON sem.id=tt.semester_id JOIN academic_years ay ON ay.id=sem.academic_year_id '
            . 'JOIN classes c ON c.id=tt.class_id AND c.academic_year_id=ay.id '
            . "WHERE ts.teacher_id=? AND {$where} ORDER BY ts.id LIMIT 1",
            [$teacherId, $value]
        );
        return $row ? $this->castAssignment($row) : null;
    }

    public function subjectForTeacher(int $teacherId, int $subjectId): ?array
    {
        return $this->assignmentForTeacher($teacherId, 0, $subjectId);
    }

    public function replaceTerm(int $userId, array $context, array $subjects): void
    {
        $teacher = $this->byUser($userId);
        if (!$teacher) throw new \RuntimeException('Teacher account not found.');
        $this->db->prepare(
            'INSERT INTO teacher_terms(teacher_id,semester_id,class_id) VALUES(?,?,?) '
            . 'ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)'
        )->execute([$teacher['id'], $context['semester_id'], $context['class_id']]);
        $termId = (int) $this->db->lastInsertId();
        $desired = array_fill_keys(array_map(static fn (array $subject): int => (int) $subject['id'], $subjects), true);
        $existing = $this->all('SELECT id,subject_id FROM teacher_subjects WHERE teacher_term_id=?', [$termId]);
        $existingSubjects = [];
        foreach ($existing as $assignment) {
            $subjectId = (int) $assignment['subject_id'];
            $existingSubjects[$subjectId] = true;
            if (isset($desired[$subjectId])) continue;
            $used = $this->one('SELECT id FROM attendance_sessions WHERE teacher_subject_id=? LIMIT 1', [(int) $assignment['id']]);
            if ($used) throw new \DomainException('A subject with attendance history cannot be removed from this term.');
            $this->db->prepare('DELETE FROM teacher_subjects WHERE id=?')->execute([(int) $assignment['id']]);
        }
        $newSubjects = array_values(array_filter($subjects, static fn (array $subject): bool => !isset($existingSubjects[(int) $subject['id']])));
        $this->linkSubjects((int) $teacher['id'], $termId, $newSubjects);
        $this->syncLegacyFields((int) $teacher['id']);
    }

    private function storeTerm(int $teacherId, array $context, array $subjects): void
    {
        $this->db->prepare('INSERT INTO teacher_terms(teacher_id,semester_id,class_id) VALUES(?,?,?)')->execute([$teacherId, $context['semester_id'], $context['class_id']]);
        $this->linkSubjects($teacherId, (int) $this->db->lastInsertId(), $subjects);
    }

    private function linkSubjects(int $teacherId, int $termId, array $subjects): void
    {
        $link = $this->db->prepare('INSERT INTO teacher_subjects(teacher_id,teacher_term_id,subject_id) VALUES(?,?,?)');
        foreach ($subjects as $subject) $link->execute([$teacherId, $termId, $subject['id']]);
    }

    private function syncLegacyFields(int $teacherId): void
    {
        $primary = $this->one(
            'SELECT sub.id,sub.code,sub.year_level FROM teacher_subjects ts JOIN subjects sub ON sub.id=ts.subject_id WHERE ts.teacher_id=? ORDER BY ts.id LIMIT 1',
            [$teacherId]
        );
        $classes = $this->all('SELECT DISTINCT c.name FROM teacher_terms tt JOIN classes c ON c.id=tt.class_id WHERE tt.teacher_id=? ORDER BY c.name', [$teacherId]);
        $this->db->prepare('UPDATE teachers SET class_name=?,subject_id=?,subject_code=?,year_level=? WHERE id=?')->execute([
            implode(',', array_column($classes, 'name')),
            $primary['id'] ?? null,
            $primary['code'] ?? null,
            $primary['year_level'] ?? null,
            $teacherId,
        ]);
    }

    private function castAssignment(array $row): array
    {
        foreach (['assignment_id', 'id', 'teacher_term_id', 'year_level', 'semester_id', 'semester_number', 'academic_year_id', 'class_id'] as $key) {
            if (array_key_exists($key, $row) && $row[$key] !== null) $row[$key] = (int) $row[$key];
        }
        return $row;
    }
}
