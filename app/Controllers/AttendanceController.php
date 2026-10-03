<?php namespace App\Controllers;

use App\Services\AttendanceService;

final class AttendanceController extends BaseController
{
    public function create(): array
    {
        $user = $this->auth()->role('teacher');
        return (new AttendanceService($this->db))->create($user['id'], $this->input);
    }

    public function active(): array
    {
        $user = $this->auth()->role('teacher');
        return (new AttendanceService($this->db))->active($user['id']);
    }

    public function end(): array
    {
        $user = $this->auth()->role('teacher');
        return (new AttendanceService($this->db))->end($user['id'], $this->input);
    }

    public function live(): array
    {
        $user = $this->auth()->role('teacher');
        return (new AttendanceService($this->db))->live($user['id'], $this->input);
    }

    public function sessions(): array
    {
        $user = $this->auth()->role('teacher');
        return (new AttendanceService($this->db))->sessions($user['id'], $this->input);
    }

    public function session(): array
    {
        $user = $this->auth()->role('teacher');
        return (new AttendanceService($this->db))->sessionAttendance($user['id'], $this->input);
    }

    public function manual(): array
    {
        $user = $this->auth()->role('teacher');
        return (new AttendanceService($this->db))->manual($user['id'], $this->input);
    }
}
