<?php

return [
    // TEMPORARY local development only. Set false before deployment.
    // Only direct loopback requests may explicitly skip GPS.
    'allow_local_development_bypass' => filter_var(getenv('ATTENDANCE_ALLOW_LOCAL_BYPASS') ?: 'false', FILTER_VALIDATE_BOOLEAN),
    // Change these values to the GPS point where attendance is allowed.
    'latitude' => (float)(getenv('ATTENDANCE_LATITUDE') ?: 16.8409),
    'longitude' => (float)(getenv('ATTENDANCE_LONGITUDE') ?: 96.1735),
    'allowed_radius_meters' => (float)(getenv('ATTENDANCE_RADIUS_METERS') ?: 100),

    // Browser readings worse than this are rejected even when their center point
    // appears to fall inside the allowed radius.
    'maximum_accuracy_meters' => (float)(getenv('ATTENDANCE_MAX_ACCURACY_METERS') ?: 100),
];
