package com.kolyagames.corsamess;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(CorsaNativePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
