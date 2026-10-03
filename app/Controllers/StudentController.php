<?php

namespace App\Controllers;

use App\Models\Attendance;
use App\Models\Schedule;
use App\Models\Student;
use App\Services\AttendanceService;

final class StudentController extends BaseController
{
    public function profile(): array
    {
        $user = $this->auth()->role('student');
        return ['profile' => (new Student($this->db))->profile($user['id'])];
    }

    public function attendance(): array
    {
        $user = $this->auth()->role('student');
        return ['attendance' => (new Attendance($this->db))->history($user['id'])];
    }

    public function schedule(): array
    {
        $user = $this->auth()->role('student');
        $student = (new Student($this->db))->byUser($user['id']);
        return ['schedules' => (new Schedule($this->db))->forStudent((int) $student['semester_id'])];
    }

    public function scan(): array
    {
        $user = $this->auth()->role('student');
        return (new AttendanceService($this->db))->scan(
            $user['id'],
            trim((string) ($this->input['token'] ?? '')),
            $this->input
        );
    }
}
