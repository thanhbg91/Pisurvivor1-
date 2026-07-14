import { initializeApp } from "firebase/app";
import { initializeFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyAH7L6TwspX-xleOEvRY5NDbkmeXAdT56k",
  authDomain: "praxis-informatics-xd2jw.firebaseapp.com",
  projectId: "praxis-informatics-xd2jw",
  storageBucket: "praxis-informatics-xd2jw.firebasestorage.app",
  messagingSenderId: "366383131946",
  appId: "1:366383131946:web:37f12a4b78150de020c253"
};

const app = initializeApp(firebaseConfig);

// Initialize Firestore with custom databaseId
const db = initializeFirestore(app, {}, "ai-studio-pioneersurvivors-9ab7dd19-78d1-469d-9c2f-83e331f8afcd");

export { db };
