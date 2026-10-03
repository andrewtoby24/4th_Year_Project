<?php

namespace App\Services;

use App\Helpers\AttendanceCalculator;
use App\Helpers\HttpException;
use App\Models\Student;
use App\Models\Teacher;

final class ReportService
{
    private const REQUIRED_PERCENTAGE = 75;

    public function __construct(private \PDO $db) {}

    public function monthly(array $user, array $filters = []): array
    {
        $month = (string)($filters['month'] ?? date('Y-m'));
        if (!preg_match('/^\d{4}-(0[1-9]|1[0-2])$/', $month)) {
            throw new HttpException('Month must use YYYY-MM format.', 422);
        }

        $start = $month . '-01 00:00:00';
        $end = date('Y-m-d H:i:s', strtotime($start . ' +1 month'));

        return $user['role'] === 'student'
            ? $this->studentMonthly($user, $month, $start, $end)
            : $this->teacherMonthly(
                $user,
                $month,
                $start,
                $end,
                (int)($filters['teacher_subject_id'] ?? 0),
                (int)($filters['subject_id'] ?? 0)
            );
    }

    private function studentMonthly(array $user, string $month, string $start, string $end): array
    {
        $student = (new Student($this->db))->byUser((int) $user['id']);
        if (!$student) throw new HttpException('Student account not found.', 404);

        $statement = $this->db->prepare(
            "SELECT sub.id,sub.code,sub.name,sub.semester_id,
                    COUNT(DISTINCT x.id) total_sessions,
                    COUNT(DISTINCT CASE WHEN a.status IN ('present','late') THEN a.session_id END) attended
             FROM subjects sub
             LEFT JOIN attendance_sessions x ON x.subject_id=sub.id AND x.starts_at>=? AND x.starts_at<?
                AND EXISTS (
                    SELECT 1 FROM teacher_subjects tsa JOIN teacher_terms tt ON tt.id=tsa.teacher_term_id
                    WHERE tsa.id=x.teacher_subject_id AND tt.class_id=? AND tt.semester_id=?
                )
             LEFT JOIN attendance a ON a.session_id=x.id AND a.student_id=?
             WHERE sub.semester_id=? AND sub.teacher_registration_enabled=1
             GROUP BY sub.id,sub.code,sub.name,sub.semester_id ORDER BY sub.name,sub.id"
        );
        $statement->execute([$start, $end, $student['class_id'], $student['semester_id'], $student['id'], $student['semester_id']]);

        $response = $this->response($statement->fetchAll(), $month, (int) $student['year_level']);
        $response['semester_id'] = (int) $student['semester_id'];
        return $response;
    }

    private function teacherMonthly(array $user, string $month, string $start, string $end, int $assignmentId, int $subjectId): array
    {
        $teacherModel = new Teacher($this->db);
        $teacher = $teacherModel->byUser((int) $user['id']);
        if (!$teacher) throw new HttpException('Teacher account not found.', 404);
        $subjects = $teacherModel->subjectsByUser((int)$user['id']);
        if (!$subjects) throw new HttpException('No subjects are assigned to this teacher.', 422);
        if (!$assignmentId && !$subjectId) $assignmentId = (int)$subjects[0]['assignment_id'];
        $subject = $teacherModel->assignmentForTeacher((int)$teacher['id'], $assignmentId, $subjectId);
        if (!$subject) throw new HttpException('That subject is not assigned to this teacher.', 403);

        $statement = $this->db->prepare(
            "SELECT s.id student_id,u.full_name,s.student_no,sub.code,sub.name,
                    COUNT(DISTINCT x.id) total_sessions,
                    COUNT(DISTINCT CASE WHEN a.status IN ('present','late') THEN a.session_id END) attended
             FROM students s JOIN users u ON u.id=s.user_id AND u.status='active'
             JOIN subjects sub ON sub.id=?
             LEFT JOIN attendance_sessions x ON x.teacher_subject_id=? AND x.starts_at>=? AND x.starts_at<?
             LEFT JOIN attendance a ON a.session_id=x.id AND a.student_id=s.id
             WHERE s.semester_id=? AND s.class_id=?
             GROUP BY s.id,u.full_name,s.student_no,sub.code,sub.name ORDER BY u.full_name"
        );
        $statement->execute([$subject['id'], $subject['assignment_id'], $start, $end, $subject['semester_id'], $subject['class_id']]);
        $response=$this->response($statement->fetchAll(), $month, (int)$subject['year_level']);
        $response['subject']=['id'=>(int)$subject['id'],'assignment_id'=>(int)$subject['assignment_id'],'code'=>$subject['code'],'name'=>$subject['name']];
        $response['academic_year']=['id'=>(int)$subject['academic_year_id'],'year_level'=>(int)$subject['year_level'],'name'=>$subject['academic_year_name']];
        $response['semester']=['id'=>(int)$subject['semester_id'],'number'=>(int)$subject['semester_number'],'name'=>$subject['semester_name']];
        $response['class']=['id'=>(int)$subject['class_id'],'name'=>$subject['class_name']];
        $response['subjects']=$subjects;
        return $response;
    }

    private function response(array $rows, string $month, int $yearLevel): array
    {
        $report = array_map(function (array $row): array {
            $attended = (int) $row['attended'];
            $total = (int) $row['total_sessions'];
            $percentage = AttendanceCalculator::percentage($attended, $total);
            $meetsRequirement = $percentage >= self::REQUIRED_PERCENTAGE;
            return array_merge($row, [
                'attended' => $attended,
                'total_sessions' => $total,
                'percentage' => $percentage,
                'meets_requirement' => $meetsRequirement,
                'highlight_red' => !$meetsRequirement,
                'status' => $meetsRequirement ? 'Good standing' : 'Below requirement',
            ]);
        }, $rows);

        return ['month'=>$month,'year_level'=>$yearLevel,'required_percentage'=>self::REQUIRED_PERCENTAGE,'report'=>$report];
    }
}
