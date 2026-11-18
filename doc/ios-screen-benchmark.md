# iOS screen response measurements

On November 10, 2026, we compared the legacy STF iOS screen path with the
CoreDevice `serve-web` reference on one USB-connected iPhone 14 Plus (iOS
27.0.1). We then checked live scrolling with the STF CoreDevice worker and
repeated the check through the deployed STF runtime API on that phone and an
iPhone 16 Plus (iOS 27.2).

## Same-phone comparison

The benchmark client ran in the prototype container on the Linux USB host. It
sent taps and swipes to the legacy prototype API and received MJPEG frames. In
the CoreDevice run it sent contact and release samples to `pymobiledevice3`
`serve-web`, which used the existing device tunnel, and received HEVC frames.
Both runs used the iOS Settings app on the same phone. Each run measured 24 taps
after two warmup taps, then six swipes with 400 ms of movement and a 500 ms hold
before release.

| Metric | Legacy STF (WDA and MJPEG) | CoreDevice `serve-web` (HEVC) |
| --- | ---: | ---: |
| Tap release to first confirmed frame change, median | 517 ms | 157 ms |
| Tap release to first confirmed frame change, p95 | 633 ms | 168 ms |
| Tap release to first confirmed frame change, max | 710 ms | 171 ms |
| Swipes with a frame change before release | 0 of 6 | 6 of 6 |
| Frame interval during swipe motion, median / p95 / max | 103 / 116 / 142 ms | 17 / 19 / 55 ms |
| Frame intervals above 200 ms during swipe motion | 0 of 57 | 0 of 723 |

The client timestamped complete frames when they arrived and decoded them
offline. A frame change was confirmed by luma differences in the central screen
region, with a threshold adjusted for pre-gesture noise. Percentiles use the
nearest-rank method. Motion intervals cover the detected motion, excluding the
deliberate hold. The initial swipe metric counts changes in screen pixels.
The subsequent checks matched vertical displacement to establish scrolling.

## STF CoreDevice scrolling checks

Each row is one swipe. Before deployment, the test called the STF worker over
the phone's tunnel. After deployment, the test used the authenticated prototype
screen and touch API with the worker's acknowledged input path. The client sent
20 moves at a target interval of 20 ms, then held the contact for 550 ms. Offline
frame matching identified sustained scrolling in the expected direction and
confirmed displacement while contact was still held.

| Path | iPhone | First sustained scroll after contact started | First sustained scroll before release |
| --- | --- | ---: | ---: |
| STF worker | 14 Plus, iOS 27.0.1 | 264 ms | 687 ms |
| STF worker | 16 Plus, iOS 27.2 | 288 ms | 664 ms |
| Deployed runtime API | 14 Plus, iOS 27.0.1 | 423 ms | 528 ms |
| Deployed runtime API, run 1 | 16 Plus, iOS 27.2 | 954 ms | 510 ms |
| Deployed runtime API, run 2 | 16 Plus, iOS 27.2 | 909 ms | 517 ms |

| Deployed runtime API | 14 Plus | 16 Plus, runs 1 and 2 |
| --- | ---: | ---: |
| Screen request to first HEVC frame | 943 ms | 932 / 916 ms |
| First touch acknowledgment in a new session | 313 ms | 858 / 827 ms |
| Median touch acknowledgment over the swipe | 1 ms | 2 / 1 ms |
| Longest frame interval while sending moves | 50 ms | 51 / 51 ms |

The first touch includes opening the iPhone's input channel. A touch
acknowledgment measures the API round trip through dispatch to that channel.
The video measurements end at frame receipt by the test client. The reference
comparison used one phone, and the deployment checks used one or two swipes
per model. Browser rendering, public network latency and cold-start tap-to-frame
latency remain unmeasured.
