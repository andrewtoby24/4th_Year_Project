<?php

namespace App\Models;

final class Semester extends BaseModel
{
    public function catalog(): array
    {
        $years = array_map(static function (array $row): array {
            $row['id'] = (int) $row['id'];
            $row['year_level'] = (int) $row['year_level'];
            return $row;
        }, $this->all('SELECT id,year_level,name FROM academic_years ORDER BY year_level'));

        $semesters = array_map(static function (array $row): array {
            $row['id'] = (int) $row['id'];
            $row['academic_year_id'] = (int) $row['academic_year_id'];
            $row['semester_number'] = (int) $row['semester_number'];
            return $row;
        }, $this->all('SELECT id,academic_year_id,semester_number,name FROM semesters ORDER BY academic_year_id,semester_number'));

        $classes = array_map(static function (array $row): array {
            $row['id'] = (int) $row['id'];
            $row['academic_year_id'] = (int) $row['academic_year_id'];
            return $row;
        }, $this->all('SELECT id,academic_year_id,name FROM classes ORDER BY academic_year_id,name'));

        return ['academic_years' => $years, 'semesters' => $semesters, 'classes' => $classes];
    }

    public function context(int $academicYearId, int $semesterId, ?int $classId = null): ?array
    {
        $sql = 'SELECT ay.id academic_year_id,ay.year_level,ay.name academic_year_name,'
            . 'sem.id semester_id,sem.semester_number,sem.name semester_name';
        $parameters = [$academicYearId, $semesterId];
        if ($classId !== null) {
            $sql .= ',c.id class_id,c.name class_name FROM academic_years ay '
                . 'JOIN semesters sem ON sem.academic_year_id=ay.id '
                . 'JOIN classes c ON c.academic_year_id=ay.id '
                . 'WHERE ay.id=? AND sem.id=? AND c.id=?';
            $parameters[] = $classId;
        } else {
            $sql .= ' FROM academic_years ay JOIN semesters sem ON sem.academic_year_id=ay.id '
                . 'WHERE ay.id=? AND sem.id=?';
        }
        $row = $this->one($sql, $parameters);
        if (!$row) return null;
        foreach (['academic_year_id', 'year_level', 'semester_id', 'semester_number', 'class_id'] as $key) {
            if (array_key_exists($key, $row)) $row[$key] = (int) $row[$key];
        }
        return $row;
    }

    public function defaultClassForYear(int $academicYearId): ?array
    {
        $row = $this->one(
            "SELECT c.id,c.name,c.academic_year_id FROM classes c JOIN academic_years ay ON ay.id=c.academic_year_id WHERE c.academic_year_id=? AND UPPER(c.name)=CONCAT(ay.year_level,'IT') LIMIT 1",
            [$academicYearId]
        );
        if (!$row) return null;
        $row['id'] = (int) $row['id'];
        $row['academic_year_id'] = (int) $row['academic_year_id'];
        return $row;
    }
}
