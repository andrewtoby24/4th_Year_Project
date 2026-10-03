<?php

namespace App\Controllers;

final class TeacherController extends BaseController
{
    public function dashboard(): array
    {
        return ['user' => $this->auth()->role('teacher')];
    }

    public function assignments(): array
    {
        $user = $this->auth()->role('teacher');
        return $this->auth()->updateTeacherAssignments((int) $user['id'], $this->input);
    }
}
