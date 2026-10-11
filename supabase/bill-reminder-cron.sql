-- Enable Supabase Cron first. Run only after deploying the matching worker/frontend
-- and checking the bill-reminder setup on the test household.
-- Reusing this named job updates it rather than scheduling a second producer.
select cron.schedule('bill-reminders','* * * * *',
 $$select private.enqueue_bill_reminders();$$);
-- Rollback scheduling: select cron.unschedule('bill-reminders');
