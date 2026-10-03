<?php namespace App\Controllers;
use App\Services\ReportService;
final class ReportController extends BaseController { public function monthly():array{return (new ReportService($this->db))->monthly($this->auth()->current(),$this->input);} }
