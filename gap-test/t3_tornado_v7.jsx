(function () {
    try {
        var comp = null;
        for (var i = 1; i <= app.project.numItems; i++) {
            if (app.project.item(i).name === "GapTest_T3") { comp = app.project.item(i); break; }
        }
        if (!comp) return '{"status":"error","message":"comp not found"}';
        var fx = comp.layer("Tornado").Effects.property(1);
        var report = [];

        app.beginUndoGroup("Tornado v7 - sweeping emitter cone");
        var set = function (label, mn, v) {
            try { fx.property(mn).setValue(v); report.push('"' + label + '":"ok"'); }
            catch (e) { report.push('"' + label + '":"FAIL: ' + String(e).replace(/"/g, "'").substring(0, 45) + '"'); }
        };

        // World rotation was rigid (useless for a line). Kill it; the emitter sweep makes the cone.
        try { fx.property("tc Particular-0291").expression = ""; fx.property("tc Particular-0291").setValue(0); } catch (e) {}

        // Emitter: FAST angle sweep paints rings; TRIANGLE height (no teleport) stacks rings into a funnel.
        try {
            fx.property("tc Particular-0581").expression =
                "var angRev=5.0;" +                        // revolutions / sec (fast -> full rings)
                "var hPer=2.2;" +                          // height cycle seconds (slow climb)
                "var c=(time/hPer)%2; var p=1-Math.abs(1-c);" + // triangle 0..1..0, no jump
                "var ang=time*angRev*2*Math.PI;" +
                "var yB=690, yT=110; var y=yB+(yT-yB)*p;" +
                "var rB=12, rT=240; var r=rB+(rT-rB)*p;" +  // narrow bottom, wide top
                "[640+r*Math.sin(ang), y, 0.6*r*Math.cos(ang)]";
            report.push('"emitterExpr":"ok"');
        } catch (e) { report.push('"emitterExpr":"FAIL: ' + String(e).replace(/"/g,"'").substring(0,45) + '"'); }

        set("EmitterType", "tc Particular-0782", 1);      // Point
        set("ParticlesPerSec", "tc Particular-0146", 20000); // dense for a solid funnel wall
        set("Velocity", "tc Particular-0011", 5);
        set("VelocityFromMotion", "tc Particular-0012", 0);
        set("Life", "tc Particular-0002", 1.4);           // short -> rings fade fast -> hollow spinning shell
        set("LifeRandom", "tc Particular-0065", 35);
        set("Size", "tc Particular-0027", 2.4);
        set("SizeRandom", "tc Particular-0074", 80);
        set("Opacity", "tc Particular-0033", 40);
        set("OpacityRandom", "tc Particular-0075", 45);
        set("Color", "tc Particular-0070", [0.62, 0.57, 0.52, 1]);
        set("BlendMode", "tc Particular-0069", 1);
        set("Gravity", "tc Particular-0017", -6);         // slight lift, rising energy
        set("TurbAffectPosition", "tc Particular-0711", 28); // ragged wisps
        set("MotionBlur", "tc Particular-0035", 2);       // ON: fast emitter sweep -> smooth rotational bands
        set("ShutterAngle", "tc Particular-0036", 180);   // moderate, not the v5 360 nuke

        app.endUndoGroup();
        comp.saveFrameToPng(5, new File("/Users/renzhongyi/Documents/AE_plugins_proj/gap-test/t3_frame_v7.png"));
        return '{"status":"done",' + report.join(",") + '}';
    } catch (e) {
        try { app.endUndoGroup(); } catch (e2) {}
        return '{"status":"error","message":"' + String(e).replace(/"/g, "'") + '"}';
    }
})();
