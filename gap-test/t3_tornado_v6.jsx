(function () {
    try {
        var comp = null;
        for (var i = 1; i <= app.project.numItems; i++) {
            if (app.project.item(i).name === "GapTest_T3") { comp = app.project.item(i); break; }
        }
        if (!comp) return '{"status":"error","message":"comp not found"}';
        var fx = comp.layer("Tornado").Effects.property(1);
        var report = [];

        app.beginUndoGroup("Tornado v6 - diagnose");
        var set = function (label, mn, v) {
            try { fx.property(mn).setValue(v); report.push('"' + label + '":"ok"'); }
            catch (e) { report.push('"' + label + '":"FAIL: ' + String(e).replace(/"/g, "'").substring(0, 45) + '"'); }
        };

        // slower spin, MB off -> see the raw cone geometry and confirm orbit works
        fx.property("tc Particular-0291").expression = "time * 70";  // deg/sec, gentle
        set("MotionBlur", "tc Particular-0035", 1);   // OFF for diagnosis
        set("Life", "tc Particular-0002", 3.5);       // longer life -> orbit arc visible
        set("ParticlesPerSec", "tc Particular-0146", 8000);
        set("Velocity", "tc Particular-0011", 4);
        set("TurbAffectPosition", "tc Particular-0711", 10);

        app.endUndoGroup();
        comp.saveFrameToPng(5, new File("/Users/renzhongyi/Documents/AE_plugins_proj/gap-test/t3_frame_v6.png"));
        return '{"status":"done",' + report.join(",") + '}';
    } catch (e) {
        try { app.endUndoGroup(); } catch (e2) {}
        return '{"status":"error","message":"' + String(e).replace(/"/g, "'") + '"}';
    }
})();
