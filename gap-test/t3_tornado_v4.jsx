(function () {
    try {
        var comp = null;
        for (var i = 1; i <= app.project.numItems; i++) {
            if (app.project.item(i).name === "GapTest_T3") { comp = app.project.item(i); break; }
        }
        if (!comp) return '{"status":"error","message":"comp not found"}';
        var fx = comp.layer("Tornado").Effects.property(1);
        var report = [];

        app.beginUndoGroup("Tornado v4");
        var set = function (label, mn, v) {
            try { fx.property(mn).setValue(v); report.push('"' + label + '":"ok"'); }
            catch (e) { report.push('"' + label + '":"FAIL: ' + String(e).replace(/"/g, "'").substring(0, 50) + '"'); }
        };

        // ping-pong sweep: up then down, no teleport; shaggy column via medium life + spread
        try {
            fx.property("tc Particular-0581").expression =
                "var dur=1.6; var revs=10;" +
                "var c=(time/dur)%2; var p=1-Math.abs(1-c);" +
                "var ang=(time/dur)*revs*Math.PI+time*1.8;" +
                "var yB=700; var yT=80; var y=yB+(yT-yB)*p;" +
                "var rB=50; var rT=240; var r=rB+(rT-rB)*p;" +
                "[640+r*Math.sin(ang), y, 0.35*r*Math.cos(ang)]";
            report.push('"expr":"ok"');
        } catch (e) { report.push('"expr":"FAIL"'); }

        set("Life", "tc Particular-0002", 2.0);
        set("LifeRandom", "tc Particular-0065", 40);
        set("Velocity", "tc Particular-0011", 26);
        set("ParticlesPerSec", "tc Particular-0146", 15000);
        set("Size", "tc Particular-0027", 2.8);
        set("SizeRandom", "tc Particular-0074", 85);
        set("Opacity", "tc Particular-0033", 45);
        set("TurbAffectPosition", "tc Particular-0711", 35);
        app.endUndoGroup();

        comp.saveFrameToPng(6, new File("/Users/renzhongyi/Documents/AE_plugins_proj/gap-test/t3_frame_v4.png"));
        return '{"status":"done",' + report.join(",") + '}';
    } catch (e) {
        try { app.endUndoGroup(); } catch (e2) {}
        return '{"status":"error","message":"' + String(e).replace(/"/g, "'") + '"}';
    }
})();
