(function () {
    try {
        var comp = null;
        for (var i = 1; i <= app.project.numItems; i++) {
            if (app.project.item(i).name === "GapTest_T3") { comp = app.project.item(i); break; }
        }
        if (!comp) return '{"status":"error","message":"comp not found"}';
        var fx = comp.layer("Tornado").Effects.property(1);
        var report = [];

        app.beginUndoGroup("Tornado v3");
        var set = function (label, mn, v) {
            try { fx.property(mn).setValue(v); report.push('"' + label + '":"ok"'); }
            catch (e) { report.push('"' + label + '":"FAIL: ' + String(e).replace(/"/g, "'").substring(0, 50) + '"'); }
        };

        // single slow pass bottom->top over comp duration: no teleport, no streaks
        try {
            fx.property("tc Particular-0581").expression =
                "var dur=7.0; var revs=16;" +
                "var p=Math.min(time/dur,1);" +
                "var ang=p*revs*2*Math.PI+time*1.6;" +
                "var yB=700; var yT=60; var y=yB+(yT-yB)*p;" +
                "var rB=55; var rT=260; var r=rB+(rT-rB)*p;" +
                "[640+r*Math.sin(ang), y, 0.35*r*Math.cos(ang)]";
            report.push('"expr":"ok"');
        } catch (e) { report.push('"expr":"FAIL"'); }

        set("VelocityFromMotion", "tc Particular-0012", 0);
        set("Velocity", "tc Particular-0011", 14);       // fuzz the fresh coil line
        set("Life", "tc Particular-0002", 6.5);          // column persists
        set("LifeRandom", "tc Particular-0065", 20);
        set("ParticlesPerSec", "tc Particular-0146", 16000);
        set("Size", "tc Particular-0027", 2.6);
        set("SizeRandom", "tc Particular-0074", 85);
        set("Opacity", "tc Particular-0033", 35);
        set("TurbAffectPosition", "tc Particular-0711", 22);
        set("Gravity", "tc Particular-0017", 0);
        app.endUndoGroup();

        comp.saveFrameToPng(7.5, new File("/Users/renzhongyi/Documents/AE_plugins_proj/gap-test/t3_frame_v3.png"));
        return '{"status":"done",' + report.join(",") + '}';
    } catch (e) {
        try { app.endUndoGroup(); } catch (e2) {}
        return '{"status":"error","message":"' + String(e).replace(/"/g, "'") + '"}';
    }
})();
