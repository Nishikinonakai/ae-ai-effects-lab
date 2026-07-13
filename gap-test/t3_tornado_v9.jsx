(function () {
    try {
        var comp = null;
        for (var i = 1; i <= app.project.numItems; i++) {
            if (app.project.item(i).name === "GapTest_T3") { comp = app.project.item(i); break; }
        }
        if (!comp) return '{"status":"error","message":"comp not found"}';
        var fx = comp.layer("Tornado").Effects.property(1);
        var report = [];

        app.beginUndoGroup("Tornado v9");
        var set = function (label, mn, v) {
            try { fx.property(mn).setValue(v); report.push('"' + label + '":"ok"'); }
            catch (e) { report.push('"' + label + '":"FAIL: ' + String(e).replace(/"/g, "'").substring(0, 45) + '"'); }
        };

        // Dense fast sweep: 12 rev/s packs coil turns ~27px apart; turbulence merges them into a WALL.
        // Life long enough (1.9s) to cover the full height in one lifetime -> continuous funnel.
        try {
            fx.property("tc Particular-0581").expression =
                "var angRev=12.0;" +
                "var hPer=2.0;" +
                "var c=(time/hPer)%2; var p=1-Math.abs(1-c);" +
                "var ang=time*angRev*2*Math.PI;" +
                "var yB=700, yT=70; var y=yB+(yT-yB)*p;" +
                "var rB=8, rT=150; var r=rB+(rT-rB)*Math.pow(p,0.8);" +  // slight concave taper
                "[640+r*Math.sin(ang), y, r*Math.cos(ang)]";
            report.push('"emitterExpr":"ok"');
        } catch (e) { report.push('"emitterExpr":"FAIL: ' + String(e).replace(/"/g,"'").substring(0,45) + '"'); }

        set("ParticlesPerSec", "tc Particular-0146", 40000);  // fill each coil line solid
        set("Velocity", "tc Particular-0011", 4);
        set("Life", "tc Particular-0002", 1.9);
        set("LifeRandom", "tc Particular-0065", 25);
        set("Size", "tc Particular-0027", 2.2);
        set("SizeRandom", "tc Particular-0074", 75);
        set("Opacity", "tc Particular-0033", 30);
        set("OpacityRandom", "tc Particular-0075", 40);
        set("TurbAffectPosition", "tc Particular-0711", 40);  // more spread to close coil gaps
        set("Gravity", "tc Particular-0017", -4);
        set("ShutterAngle", "tc Particular-0036", 200);

        // Camera: near-level front view, funnel vertical & centered
        for (var L = comp.numLayers; L >= 1; L--) {
            if (comp.layer(L) instanceof CameraLayer) comp.layer(L).remove();
        }
        var cam = comp.layers.addCamera("Tornado Cam", [640, 400]);
        cam.position.setValue([640, 380, -1150]);
        cam.pointOfInterest.setValue([640, 430, 0]);

        app.endUndoGroup();
        comp.saveFrameToPng(5, new File("/Users/renzhongyi/Documents/AE_plugins_proj/gap-test/t3_frame_v9.png"));
        return '{"status":"done",' + report.join(",") + '}';
    } catch (e) {
        try { app.endUndoGroup(); } catch (e2) {}
        return '{"status":"error","message":"' + String(e).replace(/"/g, "'") + '"}';
    }
})();
