<?php
declare(strict_types=1);

session_start();
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
$origin = $_SERVER['HTTP_ORIGIN'] ?? '*';
header("Access-Control-Allow-Origin: {$origin}");
header('Vary: Origin'); header('Access-Control-Allow-Credentials: true');
header('Access-Control-Allow-Headers: Content-Type, Authorization');
header('Access-Control-Allow-Methods: GET, POST, PUT, OPTIONS');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') exit;

spl_autoload_register(function (string $class): void {
    $path = dirname(__DIR__) . '/app/' . str_replace('App\\', '', $class) . '.php';
    if (str_starts_with($class, 'App\\') && is_file($path)) require $path;
});

use App\Controllers\{AdminController, AttendanceController, AuthController, ReportController, StudentController, TeacherController};
use App\Helpers\ApiResponse;

try {
    $config = require dirname(__DIR__) . '/config/database.php';
    $pdo = new PDO("mysql:host={$config['host']};dbname={$config['database']};charset={$config['charset']}", $config['username'], $config['password'], [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
    $body = json_decode(file_get_contents('php://input'), true); $body = is_array($body) ? $body : ($_SERVER['REQUEST_METHOD'] === 'GET' ? $_GET : $_POST);
    $action = (string)($_GET['action'] ?? 'health');
    $controllers = ['auth' => new AuthController($pdo, $body), 'student' => new StudentController($pdo, $body), 'teacher' => new TeacherController($pdo, $body), 'attendance' => new AttendanceController($pdo, $body), 'report' => new ReportController($pdo, $body), 'admin' => new AdminController($pdo, $body)];
    $routes = [
        'health'=>fn()=>['message'=>'QR Attendance API is running'], 'registration/subjects'=>fn()=>$controllers['auth']->registrationSubjects(), 'register'=>fn()=>$controllers['auth']->register(), 'login'=>fn()=>$controllers['auth']->login(), 'logout'=>fn()=>$controllers['auth']->logout(), 'me'=>fn()=>$controllers['auth']->me(),
        'student/profile'=>fn()=>$controllers['student']->profile(), 'student/attendance'=>fn()=>$controllers['student']->attendance(), 'student/schedule'=>fn()=>$controllers['student']->schedule(), 'student/scan'=>fn()=>$controllers['student']->scan(),
        'teacher/assignments'=>fn()=>$controllers['teacher']->assignments(),
        'attendance/create'=>fn()=>$controllers['attendance']->create(), 'attendance/generateQR'=>fn()=>$controllers['attendance']->create(), 'attendance/active'=>fn()=>$controllers['attendance']->active(), 'attendance/end'=>fn()=>$controllers['attendance']->end(), 'attendance/live'=>fn()=>$controllers['attendance']->live(), 'attendance/sessions'=>fn()=>$controllers['attendance']->sessions(), 'attendance/session'=>fn()=>$controllers['attendance']->session(), 'attendance/manual'=>fn()=>$controllers['attendance']->manual(),
        'reports/monthly'=>fn()=>$controllers['report']->monthly(), 'admin/users'=>fn()=>$controllers['admin']->users(), 'admin/verify'=>fn()=>$controllers['admin']->verify(), 'admin/status'=>fn()=>$controllers['admin']->setStatus(), 'admin/device/reset'=>fn()=>$controllers['admin']->resetDevice(), 'admin/subject'=>fn()=>$controllers['admin']->saveSubject(), 'subjects'=>fn()=>$controllers['admin']->subjects(),
    ];
    if (!isset($routes[$action])) ApiResponse::send(['message'=>'Endpoint not found'], 404);
    ApiResponse::send($routes[$action]());
} catch (App\Helpers\HttpException $e) { ApiResponse::send(['code'=>$e->errorCode(),'message'=>$e->getMessage()], $e->getCode());
} catch (Throwable $e) { error_log($e->getMessage()); ApiResponse::send(['message'=>'Server error'], 500); }
