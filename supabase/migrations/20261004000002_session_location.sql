alter table public.attendance_sessions
  add column center_latitude double precision,
  add column center_longitude double precision,
  add column center_accuracy double precision,
  add column attendance_radius_meters integer not null default 100,
  add constraint attendance_sessions_center_latitude_range
    check (center_latitude is null or center_latitude between -90 and 90),
  add constraint attendance_sessions_center_longitude_range
    check (center_longitude is null or center_longitude between -180 and 180),
  add constraint attendance_sessions_center_accuracy_nonnegative
    check (center_accuracy is null or center_accuracy >= 0),
  add constraint attendance_sessions_radius_positive
    check (attendance_radius_meters > 0);
