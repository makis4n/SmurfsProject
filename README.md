
Problem Statement

In today’s digital world, photos often contain personally identifiable information (PII) such as names, email addresses, ID numbers, or phone numbers. Sharing these images without proper safeguards exposes individuals to privacy and security risks. Current tools require manual editing, which is time-consuming and prone to error.
 Our app solves this by automatically detecting and blurring sensitive information in photos, enabling users to share images safely and confidently.
Features & Functionality
Automatic Text Extraction: Uses OCR (Optical Character Recognition) to detect text from photos.


Entity Recognition: Applies a BERT-based Named Entity Recognition (NER) model to identify sensitive entities such as emails, IDs, usernames, and phone numbers.


Privacy Blurring: Dynamically blurs detected sensitive text regions in the photo.


On-Device Processing: Keeps sensitive data local during analysis, reducing privacy risks.


User-Friendly Workflow: Import a photo, run detection, preview blur results, and save/share securely.
Development Tools
TypeScript – For strong typing and maintainability.


Expo Go (React Native framework) – To rapidly test and iterate mobile features.


VS Code – Primary IDE for coding and debugging.


Git & GitHub – Version control and collaboration.


APIs Used
Custom Backend API for running the BERT model and returning detected entities.


Expo APIs (e.g., ImagePicker, MediaLibrary) for photo import/export and storage.


Assets Used
Sample photo datasets for testing OCR and blurring accuracy.


Icon sets and UI assets for user interface polish.


Libraries Used
Tesseract.js – For OCR to extract text from photos.


BERT (via HuggingFace Transformers / custom API) – For Named Entity Recognition (NER) to detect PII.


React Native View Shot & Expo Blur – To capture and blur sensitive areas dynamically.


Expo FileSystem & MediaLibrary – For image storage and saving results.


