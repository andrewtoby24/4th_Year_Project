<?php namespace App\Helpers;

final class HttpException extends \RuntimeException
{
    public function __construct(
        string $message,
        int $status = 400,
        private string $errorCode = 'REQUEST_FAILED'
    ) {
        parent::__construct($message, $status);
    }

    public function errorCode(): string
    {
        return $this->errorCode;
    }
}

final class ApiResponse
{
    public static function send(array $data, int $status = 200): never
    {
        http_response_code($status);
        echo json_encode(['ok' => $status < 400] + $data);
        exit;
    }
}
