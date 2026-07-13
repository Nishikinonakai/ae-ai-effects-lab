(function () {
    var comp = null;
    for (var i = 1; i <= app.project.numItems; i++) {
        if (app.project.item(i).name === "GapTest_T1") { comp = app.project.item(i); break; }
    }
    if (!comp) return '{"status":"error","message":"T1 comp not found"}';
    var fx = comp.layer("Particular Host").Effects.property(1);
    var out = [];
    for (var v = 1; v <= 4; v++) {
        var r;
        try {
            fx.property("tc Particular-0577").setValue(v);
            try {
                fx.property("tc Particular-0015").setValue(200 + v);
                r = "Y-writable";
            } catch (e1) { r = "Y-hidden"; }
        } catch (e2) { r = "mode-rejected"; }
        out.push('"mode' + v + '":"' + r + '"');
    }
    fx.property("tc Particular-0577").setValue(1);
    return "{" + out.join(",") + "}";
})();
