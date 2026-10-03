<?php

namespace App\Services;

use App\Helpers\HttpException;

final class LocationVerificationService
{
    private const EARTH_RADIUS_METERS = 6371000.0;

    public function __construct(private array $config)
    {
    }

    public function verify(array $input): array
    {
        if (($input['development_location_bypass'] ?? false) === true
            && ($this->config['allow_local_development_bypass'] ?? false) === true
            && in_array($_SERVER['REMOTE_ADDR'] ?? '', ['127.0.0.1', '::1', '::ffff:127.0.0.1'], true)) {
            // Never fabricate coordinates for a development attendance record.
            return [
                'latitude' => null,
                'longitude' => null,
                'accuracy' => null,
                'distance_from_classroom' => null,
                'allowed_radius' => null,
                'development_bypass' => true,
            ];
        }

        foreach (['latitude', 'longitude', 'accuracy'] as $field) {
            if (!array_key_exists($field, $input) || $input[$field] === '' || $input[$field] === null) {
                throw new HttpException(
                    'Location permission is required to record attendance.',
                    422,
                    'LOCATION_PERMISSION_REQUIRED'
                );
            }
            if (!is_numeric($input[$field])) {
                throw new HttpException('Invalid location coordinates.', 422, 'INVALID_COORDINATES');
            }
        }

        $latitude = (float)$input['latitude'];
        $longitude = (float)$input['longitude'];
        $accuracy = (float)$input['accuracy'];

        if (!is_finite($latitude) || !is_finite($longitude) || !is_finite($accuracy)
            || $latitude < -90 || $latitude > 90
            || $longitude < -180 || $longitude > 180
            || $accuracy <= 0) {
            throw new HttpException('Invalid location coordinates.', 422, 'INVALID_COORDINATES');
        }

        $schoolLatitude = (float)($this->config['latitude'] ?? NAN);
        $schoolLongitude = (float)($this->config['longitude'] ?? NAN);
        $allowedRadius = (float)($this->config['allowed_radius_meters'] ?? 0);
        $maximumAccuracy = (float)($this->config['maximum_accuracy_meters'] ?? 100);
        if (!is_finite($schoolLatitude) || !is_finite($schoolLongitude)
            || $schoolLatitude < -90 || $schoolLatitude > 90
            || $schoolLongitude < -180 || $schoolLongitude > 180
            || $allowedRadius <= 0 || $maximumAccuracy <= 0) {
            throw new \RuntimeException('Attendance location configuration is invalid.');
        }

        if ($accuracy > $maximumAccuracy) {
            throw new HttpException(
                'Your location is not accurate enough. Enable precise GPS/location and try again.',
                422,
                'POOR_LOCATION_ACCURACY'
            );
        }

        $distance = $this->haversineDistance($latitude, $longitude, $schoolLatitude, $schoolLongitude);
        if ($distance > $allowedRadius) {
            throw new HttpException(
                'You are outside the allowed attendance area.',
                403,
                'OUTSIDE_ALLOWED_AREA'
            );
        }

        return [
            'latitude' => round($latitude, 7),
            'longitude' => round($longitude, 7),
            'accuracy' => round($accuracy, 2),
            'distance_from_classroom' => round($distance, 2),
            'allowed_radius' => $allowedRadius,
        ];
    }

    private function haversineDistance(float $fromLatitude, float $fromLongitude, float $toLatitude, float $toLongitude): float
    {
        $latitudeDelta = deg2rad($toLatitude - $fromLatitude);
        $longitudeDelta = deg2rad($toLongitude - $fromLongitude);
        $fromLatitudeRadians = deg2rad($fromLatitude);
        $toLatitudeRadians = deg2rad($toLatitude);

        $a = sin($latitudeDelta / 2) ** 2
            + cos($fromLatitudeRadians) * cos($toLatitudeRadians) * sin($longitudeDelta / 2) ** 2;
        $a = min(1.0, max(0.0, $a));

        return self::EARTH_RADIUS_METERS * 2 * atan2(sqrt($a), sqrt(1 - $a));
    }
}
