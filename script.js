cv['onRuntimeInitialized'] = () => {

    const dropzone = document.getElementById("dropzone");
    const output = document.getElementById("output");

    dropzone.addEventListener("dragover", e => {
        e.preventDefault();
    });

    dropzone.addEventListener("drop", e => {
        e.preventDefault();
        const file = e.dataTransfer.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = () => {
            processImage(reader.result);
        };
        reader.readAsDataURL(file);
    });

    function processImage(dataURL) {
        output.textContent = "Processing image...";

        let img = new Image();
        img.onload = () => {
            let src = cv.imread(img);
            let gray = new cv.Mat();
            cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

            output.textContent = "Image loaded. (Template matching goes here)";

            src.delete();
            gray.delete();
        };
        img.src = dataURL;
    }
};
