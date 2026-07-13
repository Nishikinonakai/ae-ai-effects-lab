(function () {
    try {
        var comp = null;
        for (var i = 1; i <= app.project.numItems; i++) {
            if (app.project.item(i).name === "GapTest_T1") { comp = app.project.item(i); break; }
        }
        if (!comp) return '{"status":"error","message":"comp not found"}';
        var fx = comp.layer(1).Effects.property(1);

        app.beginUndoGroup("Golden Dust Params");
        var set = function (mn, v) { fx.property(mn).setValue(v); };

        set("tc Particular-0782", 2);              // Emitter Type = Box
        set("tc Particular-0581", [640, 520, 0]);  // Position: lower-center
        set("tc Particular-0014", 900);            // Emitter Size XYZ (uniform box)
        set("tc Particular-0146", 350);            // Particles/sec
        set("tc Particular-0011", 40);             // Velocity (slow)
        set("tc Particular-0002", 5);              // Life (seconds)
        set("tc Particular-0065", 30);             // Life Random %
        set("tc Particular-0017", -8);             // Gravity: slight upward drift
        set("tc Particular-0750", -60);            // Wind Y: rise
        set("tc Particular-0749", 15);             // Wind X: gentle sideways
        set("tc Particular-0027", 2.5);            // Size
        set("tc Particular-0033", 80);             // Opacity
        set("tc Particular-0070", [1, 0.78, 0.35, 1]); // Color: gold
        set("tc Particular-0069", 2);              // Blend Mode = Add
        app.endUndoGroup();

        var f = new File("/Users/renzhongyi/Documents/AE_plugins_proj/gap-test/t1_frame.png");
        comp.saveFrameToPng(3, f);

        return '{"status":"success","frameSaved":' + f.exists + '}';
    } catch (e) {
        try { app.endUndoGroup(); } catch (e2) {}
        return '{"status":"error","message":"' + String(e).replace(/"/g, "'") + '"}';
    }
})();
