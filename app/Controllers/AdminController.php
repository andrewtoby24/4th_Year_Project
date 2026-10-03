<?php

namespace App\Controllers;

use App\Helpers\HttpException;
use App\Models\Student;
use App\Models\Subject;
use App\Models\User;

final class AdminController extends BaseController
{
    public function users(): array
    {
        $this->auth()->role('admin');

        return ['users' => (new User($this->db))->list()];
    }

    public function verify(): array
    {
        $this->auth()->role('admin');
        $userId = (int) ($this->input['user_id'] ?? 0);

        if (!(new User($this->db))->activate($userId)) {
            throw new HttpException('User not found or cannot be verified.', 404);
        }

        return ['message' => 'Account verified.'];
    }

    public function setStatus(): array
    {
        $this->auth()->role('admin');
        $userId = (int) ($this->input['user_id'] ?? 0);
        $status = (string) ($this->input['status'] ?? '');

        if (!in_array($status, ['active', 'disabled'], true)) {
            throw new HttpException('Status must be active or disabled.', 422);
        }
        if (!(new User($this->db))->setStatus($userId, $status)) {
            throw new HttpException('User not found or cannot be updated.', 404);
        }

        return ['message' => "Account {$status}."];
    }

    public function resetDevice(): array
    {
        $this->auth()->role('admin');
        (new Student($this->db))->resetDevice((int) ($this->input['user_id'] ?? 0));

        return ['message' => 'Device registration reset.'];
    }

    public function saveSubject(): array
    {
        $this->auth()->role('admin');
        $code = trim((string) ($this->input['code'] ?? ''));
        $name = trim((string) ($this->input['name'] ?? ''));
        $semesterId = (int) ($this->input['semester_id'] ?? 0);
        if ($name === '' || strlen($name) > 120 || strlen($code) > 30 || $semesterId <= 0) {
            throw new HttpException('Subject name and a valid semester are required.', 422);
        }
        try {
            (new Subject($this->db))->save($code === '' ? null : $code, $name, $semesterId);
        } catch (\InvalidArgumentException $exception) {
            throw new HttpException($exception->getMessage(), 422);
        }

        return ['message' => 'Subject saved.'];
    }

    public function subjects(): array
    {
        $this->auth()->current();

        return ['subjects' => (new Subject($this->db))->allSubjects()];
    }
}
