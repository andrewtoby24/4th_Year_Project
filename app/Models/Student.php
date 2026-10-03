<?php

namespace App\Models;

final class Student extends BaseModel
{
    public function create(int $userId, string $studentNo, array $context): void
    {
        $this->db->prepare(
            'INSERT INTO students(user_id,student_no,class_name,class_id,year_level,semester_id) VALUES(?,?,?,?,?,?)'
        )->execute([$userId, $studentNo, $context['class_name'], $context['class_id'], $context['year_level'], $context['semester_id']]);
    }

    public function byUser(int $userId): ?array { return $this->one('SELECT * FROM students WHERE user_id=?', [$userId]); }
    public function resetDevice(int $userId): void { $this->db->prepare('UPDATE students SET device_uuid=NULL WHERE user_id=?')->execute([$userId]); }
    public function setDevice(int $id, string $uuid): void { $this->db->prepare('UPDATE students SET device_uuid=? WHERE id=?')->execute([$uuid, $id]); }

    public function profile(int $userId): ?array
    {
        return $this->one(
            'SELECT u.full_name,u.username,s.student_no,s.class_name,s.class_id,s.year_level,s.semester_id,'
            . 'sem.semester_number,sem.name semester_name,ay.id academic_year_id,ay.name academic_year_name '
            . 'FROM users u JOIN students s ON s.user_id=u.id '
            . 'JOIN semesters sem ON sem.id=s.semester_id JOIN academic_years ay ON ay.id=sem.academic_year_id '
            . 'WHERE u.id=?',
            [$userId]
        );
    }
}
