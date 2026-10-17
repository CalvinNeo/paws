export default {
    "width": 1280,
    "height": 1120,
    "playPose": "reaching",
    "poses": {
        "sitting": {
            "file": "sitting-hd.png",
            "shadow": [
                640,
                1036,
                180,
                24
            ],
            "mirror": false
        },
        "loaf": {
            "file": "loaf-hd.png",
            "shadow": [
                640,
                1036,
                230,
                24
            ],
            "mirror": false
        },
        "sleeping": {
            "file": "sleeping-hd.png",
            "shadow": [
                640,
                1036,
                230,
                24
            ],
            "mirror": false
        },
        "relaxed": {
            "file": "relaxed-hd.png",
            "shadow": [
                640,
                1036,
                230,
                24
            ],
            "mirror": false
        },
        "reaching": {
            "file": "reaching-hd.png",
            "shadow": [
                640,
                1036,
                180,
                24
            ],
            "mirror": false
        },
        "standing": {
            "file": "standing-hd.png",
            "shadow": [
                640,
                1036,
                180,
                24
            ],
            "mirror": false,
            "optional": true,
            "source": "IMG_3345.HEIC",
            "motion": "photo-rig"
        }
    },
    "animations": {
        "eat": {
            "fps": 15,
            "frames": 64,
            "loop": false,
            "pingPong": false,
            "loopPauseMs": 0,
            "frameWidth": 768,
            "frameHeight": 672,
            "columns": 4,
            "rows": 4,
            "files": [
                "motion/eat-0.webp",
                "motion/eat-1.webp",
                "motion/eat-2.webp",
                "motion/eat-3.webp"
            ],
            "mirror": false,
            "source": {
                "file": "a4283a233e8e675a49b23a79607c4a11.mov",
                "startFrame": 960,
                "frameCount": 64,
                "frameStep": 2
            },
            "durationMs": 4267,
            "rotationDegrees": 90,
            "lighting": {
                "exposureStops": 0.9,
                "whiteBalance": [
                    0.9,
                    1.0,
                    1.22
                ]
            },
            "shadow": [
                480,
                970,
                280,
                24
            ]
        },
        "groom": {
            "fps": 15,
            "frames": 64,
            "loop": false,
            "pingPong": false,
            "loopPauseMs": 0,
            "frameWidth": 768,
            "frameHeight": 672,
            "columns": 4,
            "rows": 4,
            "files": [
                "motion/groom-0.webp",
                "motion/groom-1.webp",
                "motion/groom-2.webp",
                "motion/groom-3.webp"
            ],
            "mirror": false,
            "source": {
                "file": "181426a85ab663fe2059e5167cf63ba3.mov",
                "startFrame": 720,
                "frameCount": 64,
                "frameStep": 2
            },
            "durationMs": 4267,
            "lighting": {
                "exposureStops": 1.25,
                "whiteBalance": [
                    0.86,
                    1.0,
                    1.28
                ]
            }
        },
        "idle": {
            "fps": 18,
            "frames": 12,
            "loop": true,
            "pingPong": true,
            "loopPauseMs": 1800,
            "frameWidth": 768,
            "frameHeight": 672,
            "columns": 4,
            "rows": 4,
            "files": [
                "motion/idle-0.webp"
            ],
            "mirror": false
        },
        "watch": {
            "fps": 18,
            "frames": 12,
            "loop": true,
            "pingPong": true,
            "loopPauseMs": 600,
            "frameWidth": 768,
            "frameHeight": 672,
            "columns": 4,
            "rows": 4,
            "files": [
                "motion/watch-0.webp"
            ],
            "mirror": false
        },
        "bat": {
            "fps": 24,
            "frames": 19,
            "loop": false,
            "pingPong": false,
            "loopPauseMs": 0,
            "frameWidth": 768,
            "frameHeight": 672,
            "columns": 4,
            "rows": 4,
            "files": [
                "motion/bat-0.webp",
                "motion/bat-1.webp"
            ],
            "mirror": false
        },
        "teaser-watch": {
            "fps": 30,
            "frames": 8,
            "loop": true,
            "pingPong": true,
            "loopPauseMs": 600,
            "frameWidth": 768,
            "frameHeight": 672,
            "columns": 4,
            "rows": 4,
            "files": [
                "motion/teaser-watch-0.webp"
            ],
            "mirror": false,
            "containsJump": false,
            "placement": {
                "bounds": [
                    250,
                    650,
                    750,
                    1460
                ],
                "sourceAnchor": [
                    500,
                    1420
                ],
                "canvasAnchor": [
                    384,
                    621.6
                ],
                "scale": 0.8
            },
            "source": {
                "file": "IMG_2125.MOV",
                "startFrame": 174,
                "frameCount": 8
            },
            "durationMs": 267
        },
        "teaser-ready": {
            "fps": 30,
            "frames": 5,
            "loop": false,
            "pingPong": false,
            "loopPauseMs": 0,
            "frameWidth": 768,
            "frameHeight": 672,
            "columns": 4,
            "rows": 4,
            "files": [
                "motion/teaser-ready-0.webp"
            ],
            "mirror": false,
            "containsJump": false,
            "placement": {
                "bounds": [
                    250,
                    650,
                    750,
                    1460
                ],
                "sourceAnchor": [
                    500,
                    1420
                ],
                "canvasAnchor": [
                    384,
                    621.6
                ],
                "scale": 0.8
            },
            "source": {
                "file": "IMG_2125.MOV",
                "startFrame": 192,
                "frameCount": 5
            },
            "durationMs": 167
        }
    }
};
