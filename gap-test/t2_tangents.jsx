(function () {
    try {
        var comp = null;
        for (var i = 1; i <= app.project.numItems; i++) {
            if (app.project.item(i).name === "GapTest_T2") { comp = app.project.item(i); break; }
        }
        var fx = comp.layer("Beam").Effects.property(1);
        var pos = fx.property("tc Particular-0581");

        // Catmull-Rom spatial tangents: kill auto-bezier overshoot loops
        var n = pos.numKeys;
        for (var k = 1; k <= n; k++) {
            var p = pos.keyValue(k);
            var prev = (k > 1) ? pos.keyValue(k - 1) : p;
            var next = (k < n) ? pos.keyValue(k + 1) : p;
            var t = [(next[0] - prev[0]) / 4, (next[1] - prev[1]) / 4, (next[2] - prev[2]) / 4];
            pos.setSpatialTangentsAtKey(k, [-t[0], -t[1], -t[2]], t);
        }
        comp.saveFrameToPng(2.4, new File("/Users/renzhongyi/Documents/AE_plugins_proj/gap-test/t2_frame_v3.png"));
        return '{"tangents":"ok=' + n + '"}';
    } catch (e) {
        return '{"tangents":"FAIL: ' + String(e).replace(/"/g, "'").substring(0, 80) + '"}';
    }
})();
