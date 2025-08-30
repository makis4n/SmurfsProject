// const Tesseract = require('tesseract.js');

// // Path to the image you want to extract text from
// const imagePath = './randomimage.png';  // Reference the image in the root directory

// // Run Tesseract.js OCR
// Tesseract.recognize(
//   imagePath,
//   'eng',  // Language code ('eng' for English)
//   {
//     logger: (m) => console.log(m),  // Optional: log progress
//   }
// ).then(({ data: { text } }) => {
//   console.log('Extracted Text:', text);
// }).catch((error) => {
//   console.error('OCR Error:', error);
// });

const Tesseract = require('tesseract.js');
const fs = require('fs');  // File System module to write to files

// Path to the image you want to extract text from
const imagePath = './randomimage.png';  // Update with your image path

// Run Tesseract.js OCR
Tesseract.recognize(
  imagePath,
  'eng',  // Language code ('eng' for English)
  {
    logger: () => {}  // Suppress the progress log by providing an empty function
  }
).then(({ data: { text } }) => {
  // Define the path where you want to save the extracted text
  const outputPath = './extracted_text.txt';

  // Write the extracted text to a file in the root directory
  fs.writeFile(outputPath, text, (err) => {
    if (err) {
      console.error('Error writing to file:', err);
    } else {
      console.log('Text successfully written to extracted_text.txt');
    }
  });
}).catch((error) => {
  console.error('OCR Error:', error);
});
