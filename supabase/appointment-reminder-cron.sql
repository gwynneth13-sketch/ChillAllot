-- Enable only after reviewing plans, validating hosted setup and matching worker.
-- Reusing the named job updates it, avoiding a second producer.
select cron.schedule('appointment-reminders','* * * * *',
 $$select private.enqueue_appointment_reminders();$$);
-- Rollback scheduling: select cron.unschedule('appointment-reminders');
