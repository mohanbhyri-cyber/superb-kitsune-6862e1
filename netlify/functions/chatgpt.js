import { handleChatGPT } from '../../chatgpt-server.js';
export default request => handleChatGPT(request, process.env);
