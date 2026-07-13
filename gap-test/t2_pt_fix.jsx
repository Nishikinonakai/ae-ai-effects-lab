(function () {
    var comp = null;
    for (var i = 1; i <= app.project.numItems; i++) {
        if (app.project.item(i).name === "GapTest_T2") { comp = app.project.item(i); break; }
    }
    var fx = comp.layer("Beam").Effects.property(1);
    try {
        fx.property("tc Particular-0703").setValue(2);
        comp.saveFrameToPng(2.4, new File("/Users/renzhongyi/Documents/AE_plugins_proj/gap-test/t2_frame_v2b.png"));
        return '{"particleType0703":"ok=' + fx.property("tc Particular-0703").value + '"}';
    } catch (e) { return '{"particleType0703":"FAIL: ' + String(e).replace(/"/g, "'").substring(0, 60) + '"}'; }
})();
