(function () {
    try {
        app.beginUndoGroup("GapTest T3");
        var report = [];

        var comp = app.project.items.addComp("GapTest_T3", 1280, 720, 1, 8, 30);
        comp.openInViewer();
        var bg = comp.layers.addSolid([0.09, 0.09, 0.11], "BG", 1280, 720, 1, 8);
        var solid = comp.layers.addSolid([0, 0, 0], "Tornado", 1280, 720, 1, 8);
        var fx = solid.Effects.addProperty("tc Particular");

        var set = function (label, mn, v) {
            try { fx.property(mn).setValue(v); report.push('"' + label + '":"ok"'); }
            catch (e) { report.push('"' + label + '":"FAIL: ' + String(e).replace(/"/g, "'").substring(0, 50) + '"'); }
        };

        // expression-driven rising spiral: funnel narrow at ground, wide at top
        try {
            var pos = fx.property("tc Particular-0581");
            pos.expression =
                "var dur=1.4; var revs=7;" +
                "var p=(time/dur)%1;" +
                "var ang=p*revs*2*Math.PI+time*2.0;" +
                "var yB=680; var yT=100; var y=yB+(yT-yB)*p;" +
                "var rB=30; var rT=290; var r=rB+(rT-rB)*p;" +
                "[640+r*Math.sin(ang), y, r*Math.cos(ang)]";
            report.push('"posExpression":"ok"');
        } catch (e) {
            report.push('"posExpression":"FAIL: ' + String(e).replace(/"/g, "'").substring(0, 60) + '"');
        }

        set("EmitterType", "tc Particular-0782", 1);       // Point
        set("ParticlesPerSec", "tc Particular-0146", 9000);
        set("Velocity", "tc Particular-0011", 10);
        set("VelocityFromMotion", "tc Particular-0012", 30); // inherit swirl
        set("Life", "tc Particular-0002", 4.5);
        set("LifeRandom", "tc Particular-0065", 35);
        set("Size", "tc Particular-0027", 4);
        set("SizeRandom", "tc Particular-0074", 65);
        set("Opacity", "tc Particular-0033", 55);
        set("OpacityRandom", "tc Particular-0075", 50);
        set("Color", "tc Particular-0070", [0.55, 0.5, 0.45, 1]); // dusty
        set("BlendMode", "tc Particular-0069", 1);          // Normal (dust, not glow)
        set("GlowOpacity", "tc Particular-0216", 0);
        set("Gravity", "tc Particular-0017", 15);           // debris settles
        set("TurbAffectPosition", "tc Particular-0711", 70); // ragged wisps

        app.endUndoGroup();

        comp.saveFrameToPng(3.5, new File("/Users/renzhongyi/Documents/AE_plugins_proj/gap-test/t3_frame_a.png"));
        comp.saveFrameToPng(6.5, new File("/Users/renzhongyi/Documents/AE_plugins_proj/gap-test/t3_frame_b.png"));
        return '{"status":"done",' + report.join(",") + '}';
    } catch (e) {
        try { app.endUndoGroup(); } catch (e2) {}
        return '{"status":"error","message":"' + String(e).replace(/"/g, "'") + '"}';
    }
})();
