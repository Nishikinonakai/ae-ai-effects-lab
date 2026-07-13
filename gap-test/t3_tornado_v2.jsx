(function () {
    try {
        var comp = null;
        for (var i = 1; i <= app.project.numItems; i++) {
            if (app.project.item(i).name === "GapTest_T3") { comp = app.project.item(i); break; }
        }
        if (!comp) return '{"status":"error","message":"comp not found"}';
        var fx = comp.layer("Tornado").Effects.property(1);
        var report = [];

        app.beginUndoGroup("Tornado v2");
        var set = function (label, mn, v) {
            try { fx.property(mn).setValue(v); report.push('"' + label + '":"ok"'); }
            catch (e) { report.push('"' + label + '":"FAIL: ' + String(e).replace(/"/g, "'").substring(0, 50) + '"'); }
        };

        // taller, denser, faster-resweeping funnel; flattened in Z
        try {
            fx.property("tc Particular-0581").expression =
                "var dur=0.9; var revs=9;" +
                "var p=(time/dur)%1;" +
                "var ang=p*revs*2*Math.PI+time*2.2;" +
                "var yB=700; var yT=60; var y=yB+(yT-yB)*p;" +
                "var rB=55; var rT=250; var r=rB+(rT-rB)*p;" +
                "[640+r*Math.sin(ang), y, 0.35*r*Math.cos(ang)]";
            report.push('"expr":"ok"');
        } catch (e) { report.push('"expr":"FAIL"'); }

        set("DOF_off", "tc Particular-0319", 1);
        set("ParticlesPerSec", "tc Particular-0146", 14000);
        set("Velocity", "tc Particular-0011", 4);
        set("VelocityFromMotion", "tc Particular-0012", 8);
        set("Life", "tc Particular-0002", 3.2);
        set("Size", "tc Particular-0027", 3);
        set("SizeRandom", "tc Particular-0074", 80);
        set("Opacity", "tc Particular-0033", 40);
        set("TurbAffectPosition", "tc Particular-0711", 18);
        app.endUndoGroup();

        comp.saveFrameToPng(5, new File("/Users/renzhongyi/Documents/AE_plugins_proj/gap-test/t3_frame_v2.png"));
        return '{"status":"done",' + report.join(",") + '}';
    } catch (e) {
        try { app.endUndoGroup(); } catch (e2) {}
        return '{"status":"error","message":"' + String(e).replace(/"/g, "'") + '"}';
    }
})();
