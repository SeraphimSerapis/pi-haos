# Jinja template helper

Use `ha_render_template` with bounded inputs and explain undefined-state,
timestamp, timezone, and type-conversion behavior. Do not put secrets or
unbounded state dumps into templates. Prefer defensive defaults and test both
normal and unavailable-entity cases.
