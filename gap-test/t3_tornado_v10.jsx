(function () {
    try {
        var comp = null;
        for (var i = 1; i <= app.project.numItems; i++) {
            if (app.project.item(i).name === "GapTest_T3") { comp = app.project.item(i); break; }
        }
        if (!comp) return '{"status":"error","message":"comp not found"}';
        var fx = comp.layer("Tornado").Effects.property(1);
        var report = [];

        app.beginUndoGroup("Tornado v10");
        var set = function (label, mn, v) {
            try { fx.property(mn).setValue(v); report.push('"' + label + '":"ok"'); }
            catch (e) { report.push('"' + label + '":"FAIL: ' + String(e).replace(/"/g, "'").substring(0, 45) + '"'); }
        };

        // Add axis wander (wiggle) + lean to break the mechanical coil; narrow base at world-bottom.
        try {
            fx.property("tc Particular-0581").expression =
                "var angRev=13.0, hPer=1.9;" +
                "var c=(time/hPer)%2; var p=1-Math.abs(1-c);" +
                "var ang=time*angRev*2*Math.PI;" +
                "var yB=700, yT=60; var y=yB+(yT-yB)*p;" +
                "var rB=6, rT=155; var r=rB+(rT-rB)*Math.pow(p,0.75);" +
                "var wob=1+0.18*Math.sin(time*7+p*9);" +           // radius throb
                "var leanX=wiggle(0.7,55)[0]-value[0]+ p*40*Math.sin(time*1.3);" + // wandering + lean
                "[640+r*Math.sin(ang)*wob+leanX, y, r*Math.cos(ang)*wob]";
            report.push('"emitterExpr":"ok"');
        } catch (e) { report.push('"emitterExpr":"FAIL: ' + String(e).replace(/"/g,"'").substring(0,60) + '"'); }

        set("ParticlesPerSec", "tc Particular-0146", 50000);
        set("Life", "tc Particular-0002", 2.0);
        set("LifeRandom", "tc Particular-0065", 30);
        set("Size", "tc Particular-0027", 2.0);
        set("SizeRandom", "tc Particular-0074", 85);
        set("Opacity", "tc Particular-0033", 26);
        set("TurbAffectPosition", "tc Particular-0711", 70);   // heavy churn -> chaotic wall
        set("Gravity", "tc Particular-0017", -3);

        // Camera: look UP from near the base -> narrow touchdown low, funnel towers into frame
        for (var L = comp.numLayers; L >= 1; L--) {
            if (comp.layer(L) instanceof CameraLayer) comp.layer(L).remove();
        }
        var cam = comp.layers.addCamera("Tornado Cam", [640, 400]);
        cam.position.setValue([560, 610, -1150]);
        cam.pointOfInterest.setValue([640, 330, 0]);

        app.endUndoGroup();
        comp.saveFrameToPng(5, new File("/Users/renzhongyi/Documents/AE_plugins_proj/gap-test/t3_frame_v10.png"));
        return '{"status":"done",' + report.join(",") + '}';
    } catch (e) {
        try { app.endUndoGroup(); } catch (e2) {}
        return '{"status":"error","message":"' + String(e).replace(/"/g, "'") + '"}';
    }
})();
