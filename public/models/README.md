# Speaker diarization model

Place the Picovoice Falcon model here to enable speaker identification (話者識別):

    public/models/falcon_params.pv

Download it from the Picovoice Falcon repo:
https://github.com/Picovoice/falcon/tree/main/lib/common

Then set `NEXT_PUBLIC_PICOVOICE_ACCESS_KEY` (free key from
https://console.picovoice.ai/). Without the key and model, the diarization
feature stays off and the app behaves exactly as before.

The `.pv` model file itself is intentionally **not** committed (it's a few MB
and covered by Picovoice's license — fetch your own copy).
