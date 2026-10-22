package com.lectern.app;

import android.content.Context;
import android.media.AudioDeviceCallback;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Tells the web app where sound is going (speaker, wired, USB or Bluetooth headphones) and which
 * microphones exist, and lets it choose the mic for a take:
 *  - "phone":   record with the phone's own mic and keep Bluetooth headphones on their
 *               high-quality (A2DP) profile, the way music apps record.
 *  - "headset": record with the headset mic (on Bluetooth this means the call profile).
 *  - "release": hand audio routing back to the system after recording.
 */
@CapacitorPlugin(name = "AudioRoute")
public class AudioRoutePlugin extends Plugin {
    private AudioManager am;
    private AudioDeviceCallback callback;

    @Override
    public void load() {
        am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
        callback = new AudioDeviceCallback() {
            @Override
            public void onAudioDevicesAdded(AudioDeviceInfo[] added) { notifyListeners("routeChange", route()); }

            @Override
            public void onAudioDevicesRemoved(AudioDeviceInfo[] removed) { notifyListeners("routeChange", route()); }
        };
        am.registerAudioDeviceCallback(callback, new Handler(Looper.getMainLooper()));
    }

    @Override
    protected void handleOnDestroy() {
        if (am != null && callback != null) am.unregisterAudioDeviceCallback(callback);
    }

    @PluginMethod
    public void getRoute(PluginCall call) {
        call.resolve(route());
    }

    @PluginMethod
    public void preferMic(PluginCall call) {
        String mic = call.getString("mic", "phone");
        try {
            if ("headset".equals(mic)) {
                useHeadsetMic();
            } else if ("release".equals(mic)) {
                release();
            } else {
                usePhoneMic();
            }
            call.resolve(route());
        } catch (Exception e) {
            call.reject("Could not change the audio route: " + e.getMessage());
        }
    }

    private void usePhoneMic() {
        if (Build.VERSION.SDK_INT >= 31) {
            am.clearCommunicationDevice();
        } else {
            am.stopBluetoothSco();
            am.setBluetoothScoOn(false);
        }
        am.setMode(AudioManager.MODE_NORMAL);
        am.setSpeakerphoneOn(false);
    }

    private void useHeadsetMic() {
        if (Build.VERSION.SDK_INT >= 31) {
            for (AudioDeviceInfo d : am.getAvailableCommunicationDevices()) {
                int t = d.getType();
                if (t == AudioDeviceInfo.TYPE_BLUETOOTH_SCO || t == AudioDeviceInfo.TYPE_BLE_HEADSET
                        || t == AudioDeviceInfo.TYPE_WIRED_HEADSET || t == AudioDeviceInfo.TYPE_USB_HEADSET) {
                    am.setCommunicationDevice(d);
                    return;
                }
            }
        } else if (isBluetooth(bestOutput())) {
            am.setMode(AudioManager.MODE_IN_COMMUNICATION);
            am.startBluetoothSco();
            am.setBluetoothScoOn(true);
        }
    }

    private void release() {
        if (Build.VERSION.SDK_INT >= 31) {
            am.clearCommunicationDevice();
        } else {
            am.stopBluetoothSco();
            am.setBluetoothScoOn(false);
        }
        am.setMode(AudioManager.MODE_NORMAL);
    }

    private static boolean isBluetooth(AudioDeviceInfo d) {
        if (d == null) return false;
        int t = d.getType();
        return t == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP || t == AudioDeviceInfo.TYPE_BLUETOOTH_SCO
                || (Build.VERSION.SDK_INT >= 31 && (t == AudioDeviceInfo.TYPE_BLE_HEADSET || t == AudioDeviceInfo.TYPE_BLE_SPEAKER))
                || (Build.VERSION.SDK_INT >= 28 && t == AudioDeviceInfo.TYPE_HEARING_AID);
    }

    private static int rank(AudioDeviceInfo d) {
        int t = d.getType();
        if (isBluetooth(d)) return 5;
        if (t == AudioDeviceInfo.TYPE_USB_HEADSET || t == AudioDeviceInfo.TYPE_USB_DEVICE) return 4;
        if (t == AudioDeviceInfo.TYPE_WIRED_HEADPHONES || t == AudioDeviceInfo.TYPE_WIRED_HEADSET) return 3;
        if (t == AudioDeviceInfo.TYPE_HDMI) return 2;
        if (t == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER) return 1;
        return 0;
    }

    private AudioDeviceInfo bestOutput() {
        AudioDeviceInfo best = null;
        for (AudioDeviceInfo d : am.getDevices(AudioManager.GET_DEVICES_OUTPUTS)) {
            if (best == null || rank(d) > rank(best)) best = d;
        }
        return best;
    }

    private static String kind(AudioDeviceInfo d) {
        if (d == null) return "speaker";
        if (isBluetooth(d)) return "bluetooth";
        int t = d.getType();
        if (t == AudioDeviceInfo.TYPE_USB_HEADSET || t == AudioDeviceInfo.TYPE_USB_DEVICE) return "usb";
        if (t == AudioDeviceInfo.TYPE_WIRED_HEADPHONES || t == AudioDeviceInfo.TYPE_WIRED_HEADSET) return "wired";
        if (t == AudioDeviceInfo.TYPE_HDMI) return "hdmi";
        return "speaker";
    }

    private JSObject route() {
        JSObject r = new JSObject();
        AudioDeviceInfo out = bestOutput();
        String k = kind(out);
        r.put("output", k);
        r.put("name", out != null && !"speaker".equals(k) && out.getProductName() != null ? out.getProductName().toString() : "");
        boolean bt = false;
        for (AudioDeviceInfo d : am.getDevices(AudioManager.GET_DEVICES_OUTPUTS)) if (isBluetooth(d)) bt = true;
        r.put("bluetooth", bt);
        JSArray inputs = new JSArray();
        for (AudioDeviceInfo d : am.getDevices(AudioManager.GET_DEVICES_INPUTS)) {
            int t = d.getType();
            String type = t == AudioDeviceInfo.TYPE_BUILTIN_MIC ? "builtin"
                    : (t == AudioDeviceInfo.TYPE_BLUETOOTH_SCO || (Build.VERSION.SDK_INT >= 31 && t == AudioDeviceInfo.TYPE_BLE_HEADSET)) ? "bluetooth"
                    : (t == AudioDeviceInfo.TYPE_WIRED_HEADSET || t == AudioDeviceInfo.TYPE_USB_HEADSET || t == AudioDeviceInfo.TYPE_USB_DEVICE) ? "headset"
                    : "other";
            JSObject i = new JSObject();
            i.put("type", type);
            i.put("label", d.getProductName() != null ? d.getProductName().toString() : type);
            inputs.put(i);
        }
        r.put("inputs", inputs);
        return r;
    }
}
