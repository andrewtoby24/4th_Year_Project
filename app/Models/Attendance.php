<?php namespace App\Models;

final class Attendance extends BaseModel
{
    public function record(int $session, int $student, string $status = 'present', ?array $location = null): bool
    {
        return $this->db->prepare(
            'INSERT INTO attendance(session_id,student_id,status,latitude,longitude,accuracy,distance_from_classroom) VALUES(?,?,?,?,?,?,?)'
        )->execute([
            $session,
            $student,
            $status,
            $location['latitude'] ?? null,
            $location['longitude'] ?? null,
            $location['accuracy'] ?? null,
            $location['distance_from_classroom'] ?? null,
        ]);
    }

    public function history(int $uid): array
    {
        return $this->all('SELECT sub.code,sub.name,x.title,x.year_level,sem.semester_number,sem.name semester_name,tu.full_name teacher_name,a.status,a.recorded_at FROM attendance a JOIN students s ON s.id=a.student_id JOIN attendance_sessions x ON x.id=a.session_id JOIN teachers t ON t.id=x.teacher_id JOIN users tu ON tu.id=t.user_id JOIN subjects sub ON sub.id=x.subject_id JOIN semesters sem ON sem.id=sub.semester_id WHERE s.user_id=? ORDER BY a.recorded_at DESC', [$uid]);
    }

    public function live(int $session, int $limit = 3): array
    {
        $limit = max(1, min($limit, 100));
        return $this->all(
            'SELECT u.full_name,s.student_no,s.class_name,s.year_level,a.status,a.recorded_at '
            . 'FROM attendance a JOIN students s ON s.id=a.student_id JOIN users u ON u.id=s.user_id '
            . 'WHERE a.session_id=? ORDER BY a.recorded_at DESC,a.id DESC LIMIT ' . $limit,
            [$session]
        );
    }

    public function forSession(int $session): array
    {
        return $this->all(
            'SELECT u.full_name,s.student_no,s.class_name,s.year_level,a.status,a.recorded_at '
            . 'FROM attendance a JOIN students s ON s.id=a.student_id JOIN users u ON u.id=s.user_id '
            . 'WHERE a.session_id=? ORDER BY a.recorded_at DESC,a.id DESC',
            [$session]
        );
    }

    public function countForSession(int $session): int
    {
        $statement = $this->db->prepare('SELECT COUNT(*) FROM attendance WHERE session_id=?');
        $statement->execute([$session]);
        return (int) $statement->fetchColumn();
    }
}
