<?php namespace App\Services;

use App\Helpers\HttpException;
use App\Models\{Attendance, Student, Subject, Teacher};
use App\Services\QrCodeService;

final class AttendanceService
{
    public function __construct(private \PDO $db) {}

    public function create(int $userId, array $in): array
    {
        $teacher = (new Teacher($this->db))->byUser($userId);
        $assignmentId = (int)($in['teacher_subject_id'] ?? 0);
        $subjectId = (int)($in['subject_id'] ?? 0);
        $title = trim((string)($in['title'] ?? ''));
        if (!$teacher) {
            throw new HttpException('Teacher account not found.', 404);
        }
        $assignment = (new Teacher($this->db))->assignmentForTeacher((int)$teacher['id'], $assignmentId, $subjectId);
        if (!$assignment) {
            throw new HttpException('You can only create attendance for a subject assigned to your account.', 422);
        }
        if ($title === '' || strlen($title) > 150) {
            throw new HttpException('A title between 1 and 150 characters is required.', 422);
        }
        $token = (new QrCodeService())->token();
        $this->db->beginTransaction();
        try {
            $teacherLock = $this->db->prepare('SELECT id FROM teachers WHERE id=? FOR UPDATE');
            $teacherLock->execute([$teacher['id']]);
            $existing = $this->db->prepare('SELECT id FROM attendance_sessions WHERE teacher_id=? AND active=1 LIMIT 1');
            $existing->execute([$teacher['id']]);
            if ($existing->fetchColumn()) {
                throw new HttpException('You already have an active QR attendance session. End it before creating another.', 409, 'ACTIVE_SESSION_EXISTS');
            }

            $this->db->prepare('INSERT INTO attendance_sessions(teacher_id,subject_id,teacher_subject_id,year_level,class_name,title,starts_at,expires_at,ended_at,active) VALUES(?,?,?,?,?,?,NOW(),NULL,NULL,1)')->execute([
                $teacher['id'], $assignment['id'], $assignment['assignment_id'], $assignment['year_level'], $assignment['class_name'], $title,
            ]);
            $sessionId = (int)$this->db->lastInsertId();
            $this->db->prepare('INSERT INTO qr_codes(session_id,token_hash,display_token,expires_at,active) VALUES(?,?,?,NULL,1)')->execute([$sessionId, password_hash($token, PASSWORD_DEFAULT), $token]);
            $this->db->commit();
        } catch (\Throwable $e) {
            $this->db->rollBack();
            throw $e;
        }
        $session = $this->sessionForTeacher((int)$teacher['id'], $sessionId);
        return ['session' => $session, 'message' => 'Attendance session created.'] + $session;
    }

    public function scan(int $userId, string $token, array $locationInput): array
    {
        $token = $this->normaliseQrPayload($token);
        if ($token === '') {
            throw new HttpException('A QR token is required.', 422, 'INVALID_QR');
        }
        $student = (new Student($this->db))->byUser($userId);
        if (!$student) {
            throw new HttpException('Student account not found.', 403);
        }
        $rows = $this->db->query(
            'SELECT q.token_hash,q.session_id,q.active qr_active,x.active session_active,x.subject_id,x.teacher_id,x.year_level,x.class_name,'
            . 'sub.code subject_code,sub.name subject_name,sub.semester_id,sem.semester_number,sem.name semester_name,'
            . 'tt.class_id,c.name assigned_class_name,u.full_name teacher_name '
            . 'FROM qr_codes q JOIN attendance_sessions x ON x.id=q.session_id '
            . 'JOIN teacher_subjects tsa ON tsa.id=x.teacher_subject_id AND tsa.teacher_id=x.teacher_id AND tsa.subject_id=x.subject_id '
            . 'JOIN teacher_terms tt ON tt.id=tsa.teacher_term_id '
            . 'JOIN subjects sub ON sub.id=x.subject_id AND sub.semester_id=tt.semester_id '
            . 'JOIN semesters sem ON sem.id=sub.semester_id JOIN classes c ON c.id=tt.class_id '
            . 'JOIN teachers t ON t.id=x.teacher_id JOIN users u ON u.id=t.user_id '
            . 'WHERE q.active=1 AND x.active=1'
        )->fetchAll();
        $qr = null;
        foreach ($rows as $row) {
            if (password_verify($token, $row['token_hash'])) {
                $qr = $row;
                break;
            }
        }
        if (!$qr) {
            $ended = $this->db->prepare('SELECT q.token_hash FROM qr_codes q JOIN attendance_sessions x ON x.id=q.session_id WHERE q.display_token=? AND (q.active=0 OR x.active=0) ORDER BY q.id DESC LIMIT 1');
            $ended->execute([$token]);
            $endedHash = $ended->fetchColumn();
            if ($endedHash && password_verify($token, (string)$endedHash)) {
                throw new HttpException('This QR attendance session has ended.', 410, 'SESSION_ENDED');
            }
            throw new HttpException('Invalid QR code.', 422, 'INVALID_QR');
        }
        if ((int)$student['year_level'] !== (int)$qr['year_level']) {
            throw new HttpException('This attendance session is for a different year level.', 403);
        }
        if ((int)$student['semester_id'] !== (int)$qr['semester_id']) {
            throw new HttpException('This attendance session is for a different semester.', 403);
        }
        if ((int)$student['class_id'] !== (int)$qr['class_id']) {
            throw new HttpException('This attendance session is for a different class.', 403);
        }

        $locationConfig = require dirname(__DIR__, 2) . '/config/attendance.php';
        $location = (new LocationVerificationService($locationConfig))->verify($locationInput);

        $this->db->beginTransaction();
        try {
            $stillValid = $this->db->prepare(
                'SELECT q.id FROM qr_codes q JOIN attendance_sessions x ON x.id=q.session_id WHERE q.session_id=? AND q.active=1 AND x.active=1 FOR UPDATE'
            );
            $stillValid->execute([(int)$qr['session_id']]);
            if (!$stillValid->fetchColumn()) {
                throw new HttpException('This QR attendance session has ended.', 410, 'SESSION_ENDED');
            }

            $recorded = (new Attendance($this->db))->record(
                (int) $qr['session_id'],
                (int) $student['id'],
                'present',
                $location
            );
            if (!$recorded) {
                throw new HttpException('Attendance could not be recorded. Please try again.', 500);
            }
            $this->db->commit();
        } catch (\PDOException $e) {
            if ($this->db->inTransaction()) {
                $this->db->rollBack();
            }
            if ((int) ($e->errorInfo[1] ?? 0) === 1062) {
                throw new HttpException('Attendance has already been recorded.', 409, 'DUPLICATE_ATTENDANCE');
            }
            throw $e;
        } catch (\Throwable $e) {
            if ($this->db->inTransaction()) {
                $this->db->rollBack();
            }
            throw $e;
        }

        return [
            'code' => 'SUCCESS',
            'attendance_recorded' => true,
            'session_id' => (int)$qr['session_id'],
            'year_level' => (int)$qr['year_level'],
            'semester' => ['id' => (int)$qr['semester_id'], 'number' => (int)$qr['semester_number'], 'name' => $qr['semester_name']],
            'class' => $qr['class_name'] ?: (int)$qr['year_level'] . $this->ordinalSuffix((int)$qr['year_level']) . ' Year',
            'subject' => ['id'=>(int)$qr['subject_id'],'code'=>$qr['subject_code'],'name'=>$qr['subject_name']],
            'teacher' => ['id'=>(int)$qr['teacher_id'],'name'=>$qr['teacher_name']],
            'location' => [
                'development_bypass' => $location['development_bypass'] ?? false,
                'accuracy' => $location['accuracy'],
                'distance_from_classroom' => $location['distance_from_classroom'],
                'allowed_radius' => $location['allowed_radius'],
            ],
            'message' => 'Attendance recorded for ' . ($qr['subject_code'] ? $qr['subject_code'] . ' - ' : '') . $qr['subject_name'] . '.'
                . (!empty($location['development_bypass']) ? ' Development mode: GPS verification was skipped.' : ''),
        ];
    }

    private function normaliseQrPayload(string $payload): string
    {
        $payload = trim($payload);
        $prefix = 'ATTENDQR:';

        if (stripos($payload, $prefix) === 0) {
            $payload = substr($payload, strlen($prefix));
        }

        return strtolower(trim($payload));
    }

    public function active(int $userId): array
    {
        $teacher = (new Teacher($this->db))->byUser($userId);
        if (!$teacher) {
            throw new HttpException('Teacher account not found.', 404);
        }
        return ['session' => $this->sessionForTeacher((int)$teacher['id'])];
    }

    public function end(int $userId, array $in): array
    {
        $teacher = (new Teacher($this->db))->byUser($userId);
        if (!$teacher) {
            throw new HttpException('Teacher account not found.', 404);
        }

        $requestedSessionId = (int)($in['session_id'] ?? 0);
        $this->db->beginTransaction();
        try {
            $teacherLock = $this->db->prepare('SELECT id FROM teachers WHERE id=? FOR UPDATE');
            $teacherLock->execute([$teacher['id']]);
            $active = $this->db->prepare('SELECT id FROM attendance_sessions WHERE teacher_id=? AND active=1 ORDER BY id DESC LIMIT 1 FOR UPDATE');
            $active->execute([$teacher['id']]);
            $sessionId = (int)$active->fetchColumn();
            if (!$sessionId) {
                throw new HttpException('There is no active QR attendance session to end.', 404, 'NO_ACTIVE_SESSION');
            }
            if ($requestedSessionId && $requestedSessionId !== $sessionId) {
                throw new HttpException('That QR session is no longer the active session.', 409, 'SESSION_NOT_ACTIVE');
            }

            $this->db->prepare('UPDATE attendance_sessions SET active=0,ended_at=NOW() WHERE id=? AND active=1')->execute([$sessionId]);
            $this->db->prepare('UPDATE qr_codes SET active=0 WHERE session_id=?')->execute([$sessionId]);
            $this->db->commit();
        } catch (\Throwable $e) {
            if ($this->db->inTransaction()) {
                $this->db->rollBack();
            }
            throw $e;
        }

        return [
            'session' => $this->sessionForTeacher((int)$teacher['id'], $sessionId),
            'message' => 'QR attendance session ended. Students can no longer submit attendance.',
        ];
    }

    public function live(int $userId, array $in = []): array
    {
        $teacher = (new Teacher($this->db))->byUser($userId);
        if (!$teacher) {
            throw new HttpException('Teacher account not found.', 404);
        }
        $sessionId = (int)($in['session_id'] ?? 0);
        $session = $sessionId
            ? $this->sessionForTeacher((int)$teacher['id'], $sessionId)
            : $this->sessionForTeacher((int)$teacher['id']);
        if (!$session && !$sessionId) {
            $session = $this->sessionForTeacher((int)$teacher['id'], null, true);
        }
        if (!$session) {
            return ['session' => null, 'total_students' => 0, 'present_students' => 0, 'absent_students' => 0, 'attendance' => []];
        }
        $attendanceModel = new Attendance($this->db);
        $attendance = $attendanceModel->live((int)$session['id'], 3);
        $totalQuery=$this->db->prepare("SELECT COUNT(*) FROM students s JOIN users u ON u.id=s.user_id WHERE s.semester_id=? AND s.class_id=? AND u.status='active'");
        $totalQuery->execute([$session['semester']['id'], $session['class_id']]);
        $total = (int)$totalQuery->fetchColumn();
        $present = $attendanceModel->countForSession((int)$session['id']);
        return ['session' => $session, 'total_students' => $total, 'present_students' => $present, 'absent_students' => max(0, $total - $present), 'attendance' => $attendance];
    }

    public function sessions(int $userId, array $in): array
    {
        $teacher = (new Teacher($this->db))->byUser($userId);
        if (!$teacher) {
            throw new HttpException('Teacher account not found.', 404);
        }
        $assignmentId = (int)($in['teacher_subject_id'] ?? 0);
        $subjectId = (int)($in['subject_id'] ?? 0);
        $subject = (new Teacher($this->db))->assignmentForTeacher((int)$teacher['id'], $assignmentId, $subjectId);
        if (!$subject) {
            throw new HttpException('Select a subject assigned to your account.', 422, 'INVALID_SUBJECT');
        }

        $query = $this->db->prepare(
            'SELECT s.id,s.title,s.year_level,s.class_name,s.starts_at,s.ended_at,s.expires_at,s.active session_active,'
            . 'MAX(CASE WHEN q.active=1 THEN 1 ELSE 0 END) qr_active '
            . 'FROM attendance_sessions s LEFT JOIN qr_codes q ON q.session_id=s.id '
            . 'WHERE s.teacher_id=? AND s.teacher_subject_id=? '
            . 'GROUP BY s.id,s.title,s.year_level,s.class_name,s.starts_at,s.ended_at,s.expires_at,s.active '
            . 'ORDER BY s.starts_at DESC,s.id DESC'
        );
        $query->execute([$teacher['id'], $subject['assignment_id']]);
        $sessions = array_map(static function (array $row): array {
            $isActive = (int)$row['session_active'] === 1 && (int)$row['qr_active'] === 1;
            return [
                'id' => (int)$row['id'],
                'session_id' => (int)$row['id'],
                'title' => $row['title'],
                'year_level' => (int)$row['year_level'],
                'class_name' => $row['class_name'],
                'starts_at' => $row['starts_at'],
                'ends_at' => $isActive ? null : ($row['ended_at'] ?: $row['expires_at']),
                'status' => $isActive ? 'ACTIVE' : 'ENDED',
                'active' => $isActive,
            ];
        }, $query->fetchAll());

        return [
            'subject' => ['id' => (int)$subject['id'], 'assignment_id' => (int)$subject['assignment_id'], 'code' => $subject['code'], 'name' => $subject['name']],
            'semester' => ['id' => (int)$subject['semester_id'], 'number' => (int)$subject['semester_number'], 'name' => $subject['semester_name']],
            'sessions' => $sessions,
        ];
    }

    public function sessionAttendance(int $userId, array $in): array
    {
        $teacher = (new Teacher($this->db))->byUser($userId);
        if (!$teacher) {
            throw new HttpException('Teacher account not found.', 404);
        }
        $sessionId = (int)($in['session_id'] ?? 0);
        $session = $sessionId ? $this->sessionForTeacher((int)$teacher['id'], $sessionId) : null;
        if (!$session) {
            throw new HttpException('Attendance session not found.', 404, 'SESSION_NOT_FOUND');
        }

        $attendanceModel = new Attendance($this->db);
        $attendance = $session['active']
            ? $attendanceModel->live($sessionId, 3)
            : $attendanceModel->forSession($sessionId);

        return [
            'session' => $session,
            'present_students' => $attendanceModel->countForSession($sessionId),
            'attendance' => $attendance,
        ];
    }

    public function manual(int $userId, array $in): array
    {
        $sessionId = (int) ($in['session_id'] ?? 0);
        $studentId = (int) ($in['student_id'] ?? 0);
        $status = (string) ($in['status'] ?? 'present');
        $owner = $this->db->prepare('SELECT s.id,s.year_level,sub.semester_id,tt.class_id FROM attendance_sessions s JOIN teachers t ON t.id=s.teacher_id JOIN subjects sub ON sub.id=s.subject_id JOIN teacher_subjects tsa ON tsa.id=s.teacher_subject_id JOIN teacher_terms tt ON tt.id=tsa.teacher_term_id WHERE s.id=? AND t.user_id=?');
        $owner->execute([$sessionId, $userId]);
        $session=$owner->fetch();
        $studentQuery=$this->db->prepare('SELECT id,year_level,semester_id,class_id FROM students WHERE id=?');
        $studentQuery->execute([$studentId]);
        $student=$studentQuery->fetch();
        if (!$session || !$student
            || (int)$student['year_level'] !== (int)$session['year_level']
            || (int)$student['semester_id'] !== (int)$session['semester_id']
            || (int)$student['class_id'] !== (int)$session['class_id']
            || !in_array($status, ['present', 'late', 'absent'], true)) {
            throw new HttpException('Invalid attendance record.', 422);
        }
        try {
            (new Attendance($this->db))->record($sessionId, $studentId, $status);
        } catch (\PDOException $e) {
            if ((int) ($e->errorInfo[1] ?? 0) === 1062) {
                throw new HttpException('Attendance has already been recorded.', 409);
            }
            throw $e;
        }
        return ['message' => 'Attendance recorded successfully.'];
    }

    private function ordinalSuffix(int $year): string
    {
        if ($year % 100 >= 11 && $year % 100 <= 13) return 'th';
        return match ($year % 10) { 1 => 'st', 2 => 'nd', 3 => 'rd', default => 'th' };
    }

    private function sessionForTeacher(int $teacherId, ?int $sessionId = null, bool $latestWhenInactive = false): ?array
    {
        $where = 's.teacher_id=?';
        $parameters = [$teacherId];
        if ($sessionId !== null) {
            $where .= ' AND s.id=?';
            $parameters[] = $sessionId;
        } elseif (!$latestWhenInactive) {
            $where .= ' AND s.active=1 AND q.active=1';
        }

        $query = $this->db->prepare(
            'SELECT s.id,s.title,s.year_level,s.class_name,s.teacher_subject_id,s.starts_at,s.ended_at,s.expires_at,s.active session_active,'
            . 'q.active qr_active,sub.id subject_id,sub.code subject_code,sub.name subject_name,sub.semester_id,'
            . 'sem.semester_number,sem.name semester_name,ay.id academic_year_id,ay.name academic_year_name,'
            . 'tt.class_id,q.display_token '
            . 'FROM attendance_sessions s JOIN subjects sub ON sub.id=s.subject_id '
            . 'JOIN teacher_subjects tsa ON tsa.id=s.teacher_subject_id AND tsa.teacher_id=s.teacher_id AND tsa.subject_id=s.subject_id '
            . 'JOIN teacher_terms tt ON tt.id=tsa.teacher_term_id AND tt.semester_id=sub.semester_id '
            . 'JOIN semesters sem ON sem.id=sub.semester_id JOIN academic_years ay ON ay.id=sem.academic_year_id '
            . 'LEFT JOIN qr_codes q ON q.session_id=s.id WHERE ' . $where . ' ORDER BY s.id DESC LIMIT 1'
        );
        $query->execute($parameters);
        $row = $query->fetch();
        if (!$row) {
            return null;
        }

        $isActive = (int)$row['session_active'] === 1 && (int)$row['qr_active'] === 1;
        $token = $isActive ? ($row['display_token'] ?: null) : null;
        return [
            'id' => (int)$row['id'],
            'session_id' => (int)$row['id'],
            'title' => $row['title'],
            'year_level' => (int)$row['year_level'],
            'class_id' => (int)$row['class_id'],
            'teacher_subject_id' => (int)$row['teacher_subject_id'],
            'class_name' => $row['class_name'],
            'class' => $row['class_name'],
            'starts_at' => $row['starts_at'],
            'ended_at' => $row['ended_at'],
            'ends_at' => $isActive ? null : ($row['ended_at'] ?: $row['expires_at']),
            'status' => $isActive ? 'ACTIVE' : 'ENDED',
            'active' => $isActive,
            'subject' => [
                'id' => (int)$row['subject_id'],
                'code' => $row['subject_code'],
                'name' => $row['subject_name'],
            ],
            'academic_year' => ['id' => (int)$row['academic_year_id'], 'year_level' => (int)$row['year_level'], 'name' => $row['academic_year_name']],
            'semester' => ['id' => (int)$row['semester_id'], 'number' => (int)$row['semester_number'], 'name' => $row['semester_name']],
            'token' => $token,
            'qr_payload' => $token ? 'ATTENDQR:' . $token : null,
        ];
    }
}
