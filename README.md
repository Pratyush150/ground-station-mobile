# ground-station-mobile

![React Native](https://img.shields.io/badge/React%20Native-0.74-20232a)
![Expo](https://img.shields.io/badge/Expo-SDK%2051-000020)
![TypeScript](https://img.shields.io/badge/TypeScript-5.3-3178c6)
![MAVLink](https://img.shields.io/badge/MAVLink-v1%20%2B%20v2-1f6feb)
![Tests](https://img.shields.io/badge/core%20tests-131%20passing-31c36b)

A phone-sized ground-control station: it decodes MAVLink telemetry from a drone
and shows a flight display, the mission, and alerts that do not chatter.

## The problem

You are standing in a field with a transmitter in one hand. The laptop running
the full ground station is in the car, or its battery is flat, or the screen is
unreadable in the sun. What you actually need in that moment is small: attitude,
altitude, battery, how far away it is, which waypoint it is flying to, and a
loud signal when the link drops.

The desktop ground stations are excellent and enormous. The phone apps that
exist tend to be either a remote viewer for a desktop station or a vendor app
locked to one airframe. And nearly all of them share one dangerous habit: when
telemetry stops arriving, they keep displaying the last value they received, in
the same colour, as though it were live.

## What it does

- **Decodes MAVLink v1 and v2** from a byte stream, with CRC-16/MCRF4XX
  validation including `CRC_EXTRA`, sequence-gap accounting, resynchronisation
  after garbage, and correct handling of frames split across reads.
- **Tracks the age of every telemetry group separately.** Attitude, position,
  battery, GPS, air data and heartbeat each carry their own staleness budget.
  Stale values are rendered greyed, hatched and dashed, never as live numbers.
- **Decodes flight modes for both stacks.** PX4 packs main and sub mode into
  `custom_mode`; ArduPilot uses a flat number that means different things on
  copter and plane. Both are handled, along with the armed bit.
- **Alerts with hysteresis and on-delay** for low and critical battery, link
  loss, degraded GPS, geofence breach and stale telemetry. Every rule has an
  explicit set condition and an explicit clear condition, so none of them can
  oscillate on a threshold.
- **Mission monitoring**: waypoint list, distance remaining measured along the
  planned path, ETA from current groundspeed, and pre-flight validation that
  catches waypoints at 0/0, out-of-range coordinates and implausible legs.
- **Runs with no aircraft.** A deterministic demo link synthesises a full
  flight - arm, takeoff, four-waypoint box, RTL, land - as real MAVLink frames,
  with injectable faults: link dropout, CRC corruption, GPS degradation and
  accelerated battery drain.
- **Transports behind one interface**: UDP, TCP, USB serial and demo. The core
  never knows which one it is reading.

## Quickstart

Everything under `src/core` is plain TypeScript with no React Native imports,
so the telemetry logic, its tests and a full simulated flight run without the
mobile toolchain:

```bash
npm install               # see the note below
npm test                  # 131 tests
npm run typecheck:core    # typechecks src/core and the tests
npm run demo              # a complete simulated flight, in the terminal
npm run demo -- --faults  # the same flight with a dropout, GPS loss and fast drain
```

`npm install` pulls the whole Expo and React Native toolchain, because that is
what the app itself needs. The core suite does not: it depends only on
`typescript`, `vitest` and `@types/node`, three of the declared dev
dependencies, and on nothing from React Native. Those three alone are what
produced the test results and the demo output quoted in this README.

Running the app on a phone:

```bash
npx expo start     # then scan the QR code with Expo Go
```

In Expo Go the demo link works and every screen is live. UDP, TCP and USB
serial need a development build, because they use native socket modules that
are not part of the Expo Go binary:

```bash
npx expo prebuild
npx expo run:android   # or run:ios
```

## How it works

```
  ┌────────────┐   bytes    ┌─────────────┐  MavlinkFrame  ┌──────────────┐
  │ TelemetryLink ─────────▶│ FrameParser │───────────────▶│ decodeMessage│
  │  udp / tcp  │  (chunks, │  resync,    │  (validated,   │  typed union │
  │  serial     │   partial │  CRC_EXTRA, │   in order)    └──────┬───────┘
  │  demo       │  frames)  │  seq gaps   │                       │
  └────────────┘            └─────────────┘                       │ DecodedMessage
         ▲                         │                              ▼
         │                         │ ParserStats        ┌────────────────────┐
         │                         └───────────────────▶│ VehicleStateStore  │
         │                                              │  state + per-field │
         │                                              │  staleness         │
         │                                              └─────────┬──────────┘
         │                                                        │ VehicleState
         │                          ┌─────────────┐               ▼
         │                          │ AlertEngine │◀────── context (battery, link
         │                          │ hysteresis, │         age, GPS, geofence,
         │                          │ on/off delay│         stale fields)
         │                          └──────┬──────┘
         │                                 │ ActiveAlert[]
         │                                 ▼
         │                       ┌──────────────────────┐
         └───────── connect ─────│  useTelemetry (5 Hz) │
                                 │  publishes snapshots │
                                 └──────────┬───────────┘
                                            ▼
              Flight (PFD)   Map   Mission   Alerts   Connect   Settings
```

Walkthrough of one frame:

1. A transport hands `useTelemetry` a chunk of bytes. It does not care whether
   that chunk is a whole datagram, half a frame, or three frames and a fragment.
2. `FrameParser` appends the chunk to its residual buffer, finds a start marker,
   waits if the frame is incomplete, and validates the checksum with the message
   `CRC_EXTRA` folded in. Bad frames are counted and dropped; the parser resyncs
   one byte at a time rather than trusting a length field it could not verify.
3. Sequence numbers are tracked per sender, modulo 256, so lost frames are
   counted rather than inferred from a signal-strength bar.
4. `decodeMessage` reads the payload with little-endian `DataView` readers into
   a typed union. MAVLink v2 payloads are zero-extended first, because the
   sender is allowed to trim trailing zero bytes.
5. `VehicleStateStore` folds the message into an immutable `VehicleState` and
   marks that telemetry group as freshly updated.
6. `AlertEngine` is evaluated against the current state. It owns latching, so
   the banner and the alert feed can never disagree.
7. The hook publishes a snapshot to React at 5 Hz. Attitude arrives at up to
   50 Hz; re-rendering an SVG flight display that often would flatten the phone
   battery long before the aircraft's.

## Worked example

Real output from `npm run demo -- --faults` on this repository:

```
Demo flight, seed 1337 (faults injected)
  T+s  mode          alt   spd  home  batt  sats  link  alerts
   10 AUTO.TAKEOFF    13m   0.0     0m   92%    14   0.0s   -
   20 AUTO.TAKEOFF    38m   0.0     0m   78%    14   0.0s   -
   30 AUTO.MISSION    40m  11.8    82m   65%    14   0.0s   -
   40 AUTO.MISSION    40m   8.2   182m   51%    14   0.0s   -
   50 AUTO.MISSION    40m  12.0   193m   45%    14   5.1s   link-loss, stale-telemetry
   60 AUTO.MISSION    40m  12.0   218m   25%    14   0.0s   -
   70 AUTO.MISSION    40m   7.1   180m   12%    14   0.0s   battery-critical, battery-low
   80 AUTO.MISSION    40m  12.0    75m    0%     4   0.0s   battery-critical, battery-low
   90 AUTO.LAND       34m   0.0     7m    0%     4   0.0s   battery-critical, battery-low, gps-degraded
  100 AUTO.LAND       19m   0.0     7m    0%     4   0.0s   battery-critical, battery-low, gps-degraded
  110 AUTO.LAND        4m   0.0     7m    0%    14   0.0s   battery-critical, battery-low
  120 POSCTL           0m   0.0     7m    0%    14   0.0s   battery-critical, battery-low

link    {"framesDecoded":2912,"crcErrors":0,"framesLost":208,"bytesDropped":0,"unknownMessages":0,"lossRatePct":6.666666666666667,"lastFrameAtMs":120000}
mission 100% of 720 m planned
events  8
   T+47.9s raised link-loss: No frames for 3.0 s.
   T+48.0s raised stale-telemetry: No fresh heartbeat, battery, position, attitude data.
   T+53.5s cleared stale-telemetry: No fresh heartbeat, battery, position, attitude data.
   T+54.0s cleared link-loss: No frames for 3.0 s.
   T+63.0s raised battery-low: Battery 21 %. Plan the return leg.
   T+68.5s raised battery-critical: Battery 14 %. Land now.
   T+84.0s raised gps-degraded: Fix 2, 4 satellites, HDOP 4.2.
   T+109.0s cleared gps-degraded: Fix 2, 4 satellites, HDOP 4.2.
```

Note the eight-second dropout at T+46: the demo vehicle keeps advancing its
sequence numbers while nothing is transmitted, so 208 lost frames are counted
when the link returns - which is what a real radio dropout looks like, and what
a "frames received" counter alone would hide.

Without `--faults` the same command flies the box cleanly: 3120 frames decoded,
zero CRC errors, zero lost, and no alerts raised.

## What this handles that a tutorial does not

- **Frames split across reads.** TCP and serial deliver a byte stream with no
  message boundaries. Parsers written against a UDP capture appear to work and
  then silently drop every frame that straddles a read. There is a test that
  feeds a frame in one byte at a time.
- **`CRC_EXTRA`.** Checking only the frame CRC means a receiver built against a
  different dialect version will happily decode a message into the wrong
  fields. Folding the message-definition hash into the checksum turns that
  into a rejected frame.
- **MAVLink v2 payload truncation.** The sender may trim trailing zero bytes.
  A decoder that reads fields at fixed offsets without zero-extending first
  will either throw or return garbage for the last fields of a message.
- **Sequence wrap-around.** Sequence numbers wrap at 256 and are per sender.
  Naive subtraction reports 255 lost frames once every 256 frames, and reports
  losses that never happened as soon as a second component starts transmitting.
- **Alert chatter.** A threshold with no hysteresis and no delay fires and
  clears repeatedly while a value sits on it. Operators learn to ignore alerts
  that behave that way, which is worse than having none. Every rule here states
  a separate clear condition, and there is a test that dithers a battery
  reading across the threshold forty times and asserts exactly one event.
- **Stale telemetry that looks live.** Per-field ages, greyed and hatched
  readouts, an `ATT STALE` flag on the flight display, and a dedicated alert.
- **ETA at zero groundspeed.** Dividing distance by 0.2 m/s of GPS drift while
  hovering produces an ETA in hours next to numbers that are correct. Below
  0.5 m/s no ETA is shown at all.
- **USB enumeration.** An OTG serial adapter does not appear instantly and
  Android asks for permission on first use, so the serial link retries the
  device list instead of failing on the first empty result.
- **UDP address learning.** The vehicle's address is taken from the first
  datagram rather than typed in, because on a field WiFi network it comes from
  DHCP and changes between sessions.

## What is verified here, and what needs hardware

Verified here, with only `typescript`, `vitest` and `@types/node` installed and
no React Native toolchain present:

- `npm test` - 131 tests, 379 assertions, all passing, covering the CRC
  against its published check value, split-frame decoding, corrupted-checksum
  rejection, sequence-gap counting, little-endian readers against known byte
  patterns, PX4 and ArduPilot mode decoding, staleness transitions, haversine
  and bearing against hand-computed values, unit round-trips, geofence
  containment, mission ETA arithmetic, alert hysteresis, byte-for-byte
  determinism of the demo link, and the UDP, TCP and serial link state machines
  driven by fake sockets.
- `npm run typecheck:core` (`tsc -p tsconfig.check.json --noEmit`) - clean.
- `npm run demo` - the full pipeline end to end in a terminal.

Needs a device or a full install, and has not been exercised here:

- The React Native UI layer: the flight display, map and screens are written to
  compile against the declared versions, but rendering them requires the Expo
  toolchain and a device or simulator. `npm run typecheck` covers them once the
  toolchain is installed; it has not been run here.
- The native socket adapters (UDP, TCP, USB serial). Their logic lives behind
  injectable interfaces in `src/core/link`, so link state machines and retry
  behaviour are testable, but the native modules themselves are not.
- Behaviour against a real autopilot. The frame formats and `CRC_EXTRA` values
  come from the MAVLink `common.xml` dialect; a custom dialect needs the table
  in `src/core/telemetry/decode.ts` regenerated with mavgen.

## Limitations

- **Monitoring, not commanding.** There is no arm, disarm, mode change or
  mission upload. Sending a command from a phone over a link this app cannot
  guarantee is a decision that deserves its own design, not a button added
  because the transport happens to be bidirectional.
- **No mission download over MAVLink yet.** The mission screen renders a
  mission supplied by the demo link. The `MISSION_REQUEST_LIST` exchange is not
  implemented.
- **Geofence checks are advisory.** The authoritative fence is the one on the
  autopilot. The polygon test works in raw lat/lon degrees and is not valid
  across the antimeridian or over a pole.
- **No log recording.** Frames are parsed and discarded. Recording a session
  for later replay is an obvious next step and is not there.
- **Battery percentage from voltage is a rough guide.** Under load the pack
  sags well below the resting curve. The reported and estimated figures are
  shown separately and never blended.
- **Not a certified instrument.** The flight display is a situational-awareness
  aid. Fly by the aircraft and by the autopilot's own failsafes.

## Layout

```
src/core/          framework-free TypeScript, zero React Native imports
  telemetry/       binary readers, CRC, frame parser, message decode, modes, staleness
  geo/             haversine, bearings, geofence, coordinate formatting
  units/           metric / imperial / aviation conversion and formatting, battery
  mission/         waypoint model, progress and ETA, validation
  alerts/          hysteresis engine and the default rule set
  link/            transport interface, demo link, UDP / TCP / serial, adapters
  state/           vehicle state store and per-field staleness
  platform/        injectable scheduler (so tests never wait on a real timer)
src/components/    flight display, telemetry readouts, battery, link, alerts
src/screens/       Connect, Flight, Map, Mission, Alerts, Settings
src/hooks/         pipeline wiring and persisted settings
src/platform/      native socket adapters, behind guarded requires
tests/             the core test suite
scripts/           the command-line demo
```

## Related work

Part of a set of robotics and drone repositories:

- [px4-mavlink-companion](https://github.com/Pratyush150/px4-mavlink-companion) - MAVLink bridge, stale-telemetry watchdog, offboard control, link diagnostics
- [drone-control-toolkit](https://github.com/Pratyush150/drone-control-toolkit) - PID/LQR/EKF control and estimation with a simulation harness
- [flight-log-analyzer](https://github.com/Pratyush150/flight-log-analyzer) - PX4 ULog / ArduPilot log forensics with a ranked findings report
- [ros2-drone-bringup](https://github.com/Pratyush150/ros2-drone-bringup) - ROS 2 PX4 bringup: geodesy, missions, geofence, state machine, SITL
- [fleet-ops-dashboard](https://github.com/Pratyush150/fleet-ops-dashboard) - web dashboard for monitoring a fleet of robots and drones
- [jetson-realtime-detection](https://github.com/Pratyush150/jetson-realtime-detection) - real-time detection and tracking tuned for Jetson and edge boards

More at [github.com/Pratyush150](https://github.com/Pratyush150).

## Licence

MIT. See [LICENSE](LICENSE).
