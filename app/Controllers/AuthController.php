<?php namespace App\Controllers;
use App\Models\Subject;
final class AuthController extends BaseController {
    public function register():array{return $this->auth()->register($this->input);}
    public function login():array{return $this->auth()->login($this->input);}
    public function logout():array{return $this->auth()->logout();}
    public function me():array{return ['user'=>$this->auth()->current()];}
    public function registrationSubjects():array{return (new Subject($this->db))->registrationCatalog();}
}
