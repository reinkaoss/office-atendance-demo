# Office Attendance — tech demo

A standalone, no-backend copy of the Office Attendance app running on in-memory
sample data (`src/lib/demo.js`). There is no sign-in: it opens straight into the
app as a demo super-admin, so every tab (calendar, voting, admin) is browsable.

```bash
npm install
npm run dev
```

Nothing here talks to Supabase or Slack. Everything resets on reload. This is
not the live project — do not deploy it.
