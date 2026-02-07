function isUser(req, res, next) { //Verifica se o usuário é admin
    if(req.isAuthenticated() && req.user == 1) {
        return next();
    }

    req.flash('error_msg', 'Você precisa realizar login para acessar essa página');
    res.redirect('/users/login');

};

export default isUser;