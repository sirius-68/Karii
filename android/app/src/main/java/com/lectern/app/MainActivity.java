package com.lectern.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Lectern's own native plugin (audio routing for recording); must be registered before super.onCreate.
        registerPlugin(AudioRoutePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
