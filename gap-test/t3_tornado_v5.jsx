(function () {
    try {
        var comp = null;
        for (var i = 1; i <= app.project.numItems; i++) {
            if (app.project.item(i).name === "GapTest_T3") { comp = app.project.item(i); break; }
        }
        if (!comp) return '{"status":"error","message":"comp not found"}';
        var layer = comp.layer("Tornado");
        var fx = layer.Effects.property(1);
        var report = [];

        app.beginUndoGroup("Tornado v5 - World Rotation");
        var set = function (label, mn, v) {
            try { fx.property(mn).setValue(v); report.push('"' + label + '":"ok"'); }
            catch (e) { report.push('"' + label + '":"FAIL: ' + String(e).replace(/"/g, "'").substring(0, 45) + '"'); }
        };

        // 1) Emitter traces a fixed-angle slanted line: radius grows with height (narrow bottom -> wide top).
        //    Sawtooth in height (fast) paints the whole vertical extent; ONE side only, at angle 0.
        try {
            fx.property("tc Particular-0581").expression =
                "var hz=6;" +                         // height sweeps per second
                "var p=(time*hz)%1;" +                // 0..1 up the funnel, repeating
                "var yB=690, yT=90; var y=yB+(yT-yB)*p;" +
                "var rB=20, rT=250; var r=rB+(rT-rB)*p;" +  // funnel taper
                "[640+r, y, 0]";                      // fixed angle; World Rotation Y does the sweep
            report.push('"emitterExpr":"ok"');
        } catch (e) { report.push('"emitterExpr":"FAIL: ' + String(e).replace(/"/g,"'").substring(0,45) + '"'); }

        // 2) THE FIX: spin the whole particle world around its Y axis. Born particles orbit for free.
        try {
            fx.property("tc Particular-0291").expression = "time * 200";  // deg/sec
            report.push('"worldRotY":"ok"');
        } catch (e) { report.push('"worldRotY":"FAIL: ' + String(e).replace(/"/g,"'").substring(0,45) + '"'); }

        set("EmitterType", "tc Particular-0782", 1);      // Point
        set("ParticlesPerSec", "tc Particular-0146", 6000);
        set("Velocity", "tc Particular-0011", 6);
        set("VelocityFromMotion", "tc Particular-0012", 0); // no ejection from the fast emitter sweep
        set("Life", "tc Particular-0002", 2.6);            // shell, not filled cone
        set("LifeRandom", "tc Particular-0065", 30);
        set("Size", "tc Particular-0027", 3);
        set("SizeRandom", "tc Particular-0074", 80);
        set("Opacity", "tc Particular-0033", 45);
        set("OpacityRandom", "tc Particular-0075", 40);
        set("Color", "tc Particular-0070", [0.6, 0.55, 0.5, 1]);
        set("BlendMode", "tc Particular-0069", 1);
        set("TurbAffectPosition", "tc Particular-0711", 20); // organic edge
        set("Gravity", "tc Particular-0017", 0);
        set("MotionBlur", "tc Particular-0035", 2);        // Particular's own MB -> spin reads as streaks
        set("ShutterAngle", "tc Particular-0036", 360);

        app.endUndoGroup();

        comp.saveFrameToPng(5, new File("/Users/renzhongyi/Documents/AE_plugins_proj/gap-test/t3_frame_v5.png"));
        return '{"status":"done",' + report.join(",") + '}';
    } catch (e) {
        try { app.endUndoGroup(); } catch (e2) {}
        return '{"status":"error","message":"' + String(e).replace(/"/g, "'") + '"}';
    }
})();
