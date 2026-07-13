(function () {
    try {
        var comp = null;
        for (var i = 1; i <= app.project.numItems; i++) {
            if (app.project.item(i).name === "GapTest_T2") { comp = app.project.item(i); break; }
        }
        if (!comp) return '{"status":"error","message":"comp not found"}';
        var fx = comp.layer("Beam").Effects.property(1);
        var report = [];

        app.beginUndoGroup("Beam v2");
        var set = function (label, mn, v) {
            try { fx.property(mn).setValue(v); report.push('"' + label + '":"ok"'); }
            catch (e) { report.push('"' + label + '":"FAIL: ' + String(e).replace(/"/g, "'").substring(0, 50) + '"'); }
        };

        // gentler path, less spatial overshoot
        try {
            var pos = fx.property("tc Particular-0581");
            while (pos.numKeys > 0) pos.removeKey(1);
            var times =  [0.2, 1.2, 2.2, 3.2, 4.2];
            var values = [[80, 500, 0], [350, 300, 0], [640, 430, 0], [930, 240, 0], [1200, 360, 0]];
            for (var k = 0; k < times.length; k++) pos.setValueAtTime(times[k], values[k]);
            for (var k2 = 1; k2 <= pos.numKeys; k2++) {
                pos.setTemporalEaseAtKey(k2, [new KeyframeEase(0, 33)], [new KeyframeEase(0, 33)]);
            }
            report.push('"path":"ok=' + pos.numKeys + '"');
        } catch (e) { report.push('"path":"FAIL: ' + String(e).replace(/"/g, "'").substring(0, 50) + '"'); }

        set("ParticleType", "tc Particular-0026", 2);  // Glow Sphere (no DOF)?
        set("ParticlesPerSec", "tc Particular-0146", 9000);
        set("Velocity", "tc Particular-0011", 4);
        set("Size", "tc Particular-0027", 1.1);
        set("SizeRandom", "tc Particular-0074", 30);
        set("Opacity", "tc Particular-0033", 70);
        set("Color", "tc Particular-0070", [0.45, 0.7, 1, 1]);
        set("GlowOpacity", "tc Particular-0216", 50);
        set("GlowSize", "tc Particular-0215", 150);
        set("TurbAffectPosition", "tc Particular-0711", 6);
        app.endUndoGroup();

        comp.saveFrameToPng(2.4, new File("/Users/renzhongyi/Documents/AE_plugins_proj/gap-test/t2_frame_v2.png"));
        return '{"status":"done",' + report.join(",") + '}';
    } catch (e) {
        try { app.endUndoGroup(); } catch (e2) {}
        return '{"status":"error","message":"' + String(e).replace(/"/g, "'") + '"}';
    }
})();
