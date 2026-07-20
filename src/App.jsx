import { BrowserRouter, Routes, Route } from 'react-router';
import LandingPage from './components/LandingPage';
import Flipbook from './components/Flipbook';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        
        <Route 
          path="/ug" 
          element={
            <Flipbook 
              pdfSrc="/pdfs/UG26.pdf" 
              title="Undergraduate Prospectus 2026" 
            />
          } 
        />
        
        <Route 
          path="/pg" 
          element={
            <Flipbook 
              pdfSrc="/pdfs/PG26.pdf" 
              title="Postgraduate Prospectus 2026" 
            />
          } 
        />
      </Routes>
    </BrowserRouter>
  );
}
