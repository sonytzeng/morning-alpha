import React from 'react';
import {createRoot} from 'react-dom/client';
import LineDecisionPreview from '../../src/pages/admin/analysis/LineDecisionPreview';
import {logout} from './lineDecisionMock';
import '../../src/index.css';
import '../../src/pages/admin/analysis/analysis.css';
createRoot(document.getElementById('root')!).render(<React.StrictMode><main className="owner-analysis-layout" style={{maxWidth:1000,margin:'auto',padding:16}}>
 <p>SYNTHETIC LOCAL UI TEST — 不是正式 Owner 身分验收</p><button onClick={logout}>模擬登出</button><LineDecisionPreview/>
</main></React.StrictMode>);
