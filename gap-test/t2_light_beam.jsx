(function () {
    try {
        app.beginUndoGroup("GapTest T2");
        var report = [];

        var comp = app.project.items.addComp("GapTest_T2", 1280, 720, 1, 6, 30);
        comp.openInViewer();
        var bg = comp.layers.addSolid([0.01, 0.01, 0.02], "BG", 1280, 720, 1, 6);
        var solid = comp.layers.addSolid([0, 0, 0], "Beam", 1280, 720, 1, 6);
        var fx = solid.Effects.addProperty("tc Particular");

        var set = function (label, mn, v) {
            try {
                fx.property(mn).setValue(v);
                report.push('"' + label + '":"ok"');
            } catch (e) {
                report.push('"' + label + '":"FAIL: ' + String(e).replace(/"/g, "'").substring(0, 60) + '"');
            }
        };

        // keyframed emitter position: S-sweep across frame, 0.2s..4s
        try {
            var pos = fx.property("tc Particular-0581");
            var times =  [0.2, 1.0, 1.8, 2.6, 3.4, 4.2];
            var values = [[100, 560, 0], [380, 250, 0], [660, 500, 0], [900, 200, 0], [1120, 420, 0], [1220, 300, 0]];
            for (var k = 0; k < times.length; k++) pos.setValueAtTime(times[k], values[k]);
            report.push('"posKeyframes":"ok=' + pos.numKeys + '"');
            // smooth the path
            for (var k2 = 1; k2 <= pos.numKeys; k2++) {
                pos.setTemporalEaseAtKey(k2, [new KeyframeEase(0, 33)], [new KeyframeEase(0, 33)]);
            }
            report.push('"ease":"ok"');
        } catch (e) {
            report.push('"posKeyframes":"FAIL: ' + String(e).replace(/"/g, "'").substring(0, 60) + '"');
        }

        set("EmitterType", "tc Particular-0782", 1);   // Point
        set("ParticlesPerSec", "tc Particular-0146", 4000);
        set("Velocity", "tc Particular-0011", 15);      // tight trail
        set("VelocityFromMotion", "tc Particular-0012", 0); // don't smear from emitter motion
        set("Life", "tc Particular-0002", 2.2);
        set("LifeRandom", "tc Particular-0065", 20);
        set("Size", "tc Particular-0027", 1.6);
        set("SizeRandom", "tc Particular-0074", 50);
        set("Opacity", "tc Particular-0033", 90);
        set("OpacityRandom", "tc Particular-0075", 40);
        set("Color", "tc Particular-0070", [0.72, 0.88, 1, 1]); // cool white-blue
        set("BlendMode", "tc Particular-0069", 2);      // Add
        set("GlowOpacity", "tc Particular-0216", 80);
        set("GlowSize", "tc Particular-0215", 300);
        set("TurbAffectPosition", "tc Particular-0711", 12); // subtle wobble
        set("Gravity", "tc Particular-0017", 0);

        // CUSTOM_VALUE probe: can scripts set "Opacity Over Life" curve? (expect fail)
        try {
            fx.property("tc Particular-0570").setValue(1);
            report.push('"customValueProbe":"unexpectedly ok"');
        } catch (e) {
            report.push('"customValueProbe":"FAIL(expected): ' + String(e).replace(/"/g, "'").substring(0, 50) + '"');
        }

        app.endUndoGroup();

        comp.saveFrameToPng(2.2, new File("/Users/renzhongyi/Documents/AE_plugins_proj/gap-test/t2_frame_a.png"));
        comp.saveFrameToPng(4.0, new File("/Users/renzhongyi/Documents/AE_plugins_proj/gap-test/t2_frame_b.png"));
        return '{"status":"done",' + report.join(",") + '}';
    } catch (e) {
        try { app.endUndoGroup(); } catch (e2) {}
        return '{"status":"error","message":"' + String(e).replace(/"/g, "'") + '"}';
    }
})();
