import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: "AIzaSyD7XDyxCH7OjXYfwKapVSd2aVm24hS2TqE",
  authDomain: "jacekhan-education-app.firebaseapp.com",
  databaseURL: "https://jacekhan-education-app-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "jacekhan-education-app",
  storageBucket: "jacekhan-education-app.appspot.com",
  messagingSenderId: "409545586614",
  appId: "1:409545586614:web:cbe879113551ce817317f7"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const storage = getStorage(app);