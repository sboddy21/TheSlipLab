// Canonical public entry point for the adaptive MLB refresh.
//
// Scheduled callers use a cheap pulse unless canonical slate inputs changed or
// the last complete model build is more than an hour old.
import "./run_smart_refresh.js";
