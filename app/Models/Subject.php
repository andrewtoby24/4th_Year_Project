<?php

namespace App\Models;

final class Subject extends BaseModel
{
    public function allSubjects(): array
    {
        return array_map([$this, 'cast'], $this->all(
            'SELECT sub.id,sub.code,sub.name,sub.year_level,sub.semester_id,sub.teacher_registration_enabled,'
            . 'sem.semester_number,sem.name semester_name,ay.id academic_year_id,ay.name academic_year_name '
            . 'FROM subjects sub LEFT JOIN semesters sem ON sem.id=sub.semester_id '
            . 'LEFT JOIN academic_years ay ON ay.id=sem.academic_year_id '
            . 'ORDER BY ay.year_level,sem.semester_number,sub.name,sub.id'
        ));
    }

    public function registrationSubjects(): array
    {
        return array_map([$this, 'cast'], $this->all(
            'SELECT sub.id,sub.code,sub.name,sub.year_level,sub.semester_id,'
            . 'sem.semester_number,sem.name semester_name,ay.id academic_year_id,ay.name academic_year_name '
            . 'FROM subjects sub JOIN semesters sem ON sem.id=sub.semester_id '
            . 'JOIN academic_years ay ON ay.id=sem.academic_year_id '
            . 'WHERE sub.teacher_registration_enabled=1 '
            . 'ORDER BY ay.year_level,sem.semester_number,sub.name,sub.id'
        ));
    }

    public function registrationCatalog(): array
    {
        return (new Semester($this->db))->catalog() + ['subjects' => $this->registrationSubjects()];
    }

    public function selectableForTerm(int $academicYearId, int $semesterId, array $subjectIds): array
    {
        $subjectIds = array_values(array_unique(array_filter(array_map('intval', $subjectIds))));
        if (!$subjectIds) return [];
        $placeholders = implode(',', array_fill(0, count($subjectIds), '?'));
        $statement = $this->db->prepare(
            'SELECT sub.id,sub.code,sub.name,sub.year_level,sub.semester_id,'
            . 'sem.semester_number,sem.name semester_name,ay.id academic_year_id,ay.name academic_year_name '
            . 'FROM subjects sub JOIN semesters sem ON sem.id=sub.semester_id '
            . 'JOIN academic_years ay ON ay.id=sem.academic_year_id '
            . "WHERE sub.id IN ({$placeholders}) AND sub.teacher_registration_enabled=1 AND sem.id=? AND ay.id=? "
            . 'ORDER BY sub.name,sub.id'
        );
        $statement->execute([...$subjectIds, $semesterId, $academicYearId]);
        return array_map([$this, 'cast'], $statement->fetchAll());
    }

    public function countForTerm(int $semesterId): int
    {
        $statement = $this->db->prepare('SELECT COUNT(*) FROM subjects WHERE semester_id=? AND teacher_registration_enabled=1');
        $statement->execute([$semesterId]);
        return (int) $statement->fetchColumn();
    }

    public function save(?string $code, string $name, int $semesterId): void
    {
        $term = $this->one('SELECT sem.id,ay.year_level FROM semesters sem JOIN academic_years ay ON ay.id=sem.academic_year_id WHERE sem.id=?', [$semesterId]);
        if (!$term) throw new \InvalidArgumentException('Invalid semester.');
        $code = $code === null || trim($code) === '' ? null : strtoupper(trim($code));
        $name = trim($name);

        if ($code === null) {
            $existing = $this->one('SELECT id FROM subjects WHERE semester_id=? AND code IS NULL AND name=?', [$semesterId, $name]);
            if ($existing) {
                $this->db->prepare('UPDATE subjects SET year_level=?,teacher_registration_enabled=1 WHERE id=?')->execute([(int)$term['year_level'], $existing['id']]);
                return;
            }
            $this->db->prepare('INSERT INTO subjects(code,name,year_level,semester_id,teacher_registration_enabled) VALUES(NULL,?,?,?,1)')->execute([$name, (int)$term['year_level'], $semesterId]);
            return;
        }

        $this->db->prepare(
            'INSERT INTO subjects(code,name,year_level,semester_id,teacher_registration_enabled) VALUES(?,?,?,?,1) '
            . 'ON DUPLICATE KEY UPDATE name=VALUES(name),year_level=VALUES(year_level),teacher_registration_enabled=1'
        )->execute([$code, $name, (int)$term['year_level'], $semesterId]);
    }

    private function cast(array $row): array
    {
        foreach (['id', 'year_level', 'semester_id', 'semester_number', 'academic_year_id', 'teacher_registration_enabled'] as $key) {
            if (array_key_exists($key, $row) && $row[$key] !== null) $row[$key] = (int) $row[$key];
        }
        return $row;
    }
}
